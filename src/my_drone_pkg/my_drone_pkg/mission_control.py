import rclpy
import math
import json
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
from mavros_msgs.msg import State
from mavros_msgs.srv import CommandBool, SetMode
from geometry_msgs.msg import PoseStamped, PoseArray
from std_srvs.srv import Trigger
from std_msgs.msg import String
from rcl_interfaces.srv import SetParameters
from rcl_interfaces.msg import Parameter, ParameterValue, ParameterType


class OffboardControl(Node):
    """
    Main ROS 2 Node for controlling the drone in OFFBOARD mode via MAVROS.
    It implements a State Machine to handle the mission lifecycle: 
    Idle -> Arming -> Takeoff -> Wait Confirm -> Mission -> Hover/RTL.
    """
    
    # Definition of States
    STATE_IDLE = "IDLE"                  
    STATE_ARMING = "ARMING"              
    STATE_TAKEOFF = "TAKEOFF"            
    STATE_WAIT_CONFIRM = "WAIT_CONFIRM"  
    STATE_MISSION = "MISSION"            
    STATE_HOVER = "HOVER"                

    def __init__(self):
        super().__init__('offboard_control_node')

        # --- Service Clients ---
        # Used to send commands to the flight controller (PX4)
        self.arm_client = self.create_client(CommandBool, '/mavros/cmd/arming')
        self.set_mode_client = self.create_client(SetMode, '/mavros/set_mode')
        # Create Service Client for setting PX4 parameters
        self.param_set_client = self.create_client(SetParameters, '/mavros/param/set_parameters')

        # --- Publishers ---
        # Continuously publishes the target position/orientation to MAVROS
        self.pose_pub = self.create_publisher(PoseStamped, '/mavros/setpoint_position/local', 10)

        # Configure QoS Profile suitable for fast, loss-tolerant data transmission (Best Effort)
        self.pose_qos_profile = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
            history=HistoryPolicy.KEEP_LAST,
            depth=10
        )

        # --- Subscribers ---
        # Subscribes to the drone's current state (Armed, Mode, etc.)
        self.state_sub = self.create_subscription(State, '/mavros/state', self.state_callback, 10)
        # Subscribes to the drone's current local position and orientation
        self.pose_sub = self.create_subscription(PoseStamped, '/mavros/local_position/pose', self.pose_callback, self.pose_qos_profile)

        # --- UI Communication (Frontend / Web) ---
        # Services to trigger actions from the frontend
        self.srv_start_mission = self.create_service(Trigger, '/mission/start', self.start_mission_callback)
        self.srv_confirm_waypoint = self.create_service(Trigger, '/mission/confirm_waypoint', self.confirm_waypoint_callback)
        
        # Subscriptions to receive settings and waypoints from the frontend
        self.settings_sub = self.create_subscription(String, '/mission/settings', self.settings_callback, 10)
        self.waypoints_sub = self.create_subscription(PoseArray, '/mission/waypoints', self.waypoints_callback, 10)

        # --- Variables ---
        self.current_state = State()
        self.current_pose = PoseStamped()
        
        # Target pose represents the desired position/orientation we send to the drone
        self.target_pose = PoseStamped()
        self.target_pose.header.frame_id = "odom"

        # State Machine Tracking
        self.mission_state = self.STATE_IDLE
        self.last_state = self.STATE_IDLE
        self.mission_started = False
        self.mission_confirmed = False

        # Mission Settings (Defaults, can be updated via frontend)
        self.takeoff_alt = 3.0
        self.hover_time = 5.0
        self.cruise_speed = 5.0
        self.auto_rtl = False

        # Waypoint Management
        self.custom_waypoints = []
        self.current_wp_idx = 0
        
        # Origin tracking
        self.mission_origin = (0.0, 0.0)
        self.mission_origin_z = 0.0       
        self.takeoff_target_z = 0.0

        # Timers and Counters
        self.last_request_time = self.get_clock().now()
        self.state_start_time = self.get_clock().now()
        self.init_setpoint_count = 0  # Used to stream setpoints before arming

        # Main State Machine Timer (Runs at 20Hz)
        self.timer = self.create_timer(0.05, self.timer_callback)
        self.get_logger().info("Mission Control Node (State Machine) started.")

    def state_callback(self, msg):
        """ Updates the current state of the drone (e.g., Armed status, Flight Mode). """
        self.current_state = msg

    def pose_callback(self, msg):
        """ Updates the current local position and orientation of the drone. """
        self.current_pose = msg

    def start_mission_callback(self, request, response):
        """ Service callback to start the mission from the frontend. """
        if self.mission_state == self.STATE_IDLE:
            if not self.custom_waypoints:
                response.success = False
                response.message = "No mission waypoints received from web. Cannot start."
                return response

            self.mission_started = True
            response.success = True
            response.message = "Mission Start signal received."
        else:
            response.success = False
            response.message = f"Already in {self.mission_state} state."

        return response

    def confirm_waypoint_callback(self, request, response):
        """ Service callback to confirm proceeding to the first waypoint after takeoff. """
        if self.mission_state == self.STATE_WAIT_CONFIRM:
            self.mission_confirmed = True
            response.success = True
            response.message = "Go to waypoint confirmed."
        else:
            response.success = False
            response.message = "Not in WAITING state."

        return response

    def set_mode(self, mode):
        """ Helper function to call the SetMode service. """
        if not self.set_mode_client.service_is_ready():
            self.get_logger().warn("/mavros/set_mode service is not ready.")
            return

        future = self.set_mode_client.call_async(
            SetMode.Request(custom_mode=mode)
        )
        future.add_done_callback(
            lambda fut, requested_mode=mode:
            self.mode_response_callback(fut, requested_mode)
        )

    def arm(self, value=True):
        """ Helper function to call the Arming service. """
        if not self.arm_client.service_is_ready():
            self.get_logger().warn("/mavros/cmd/arming service is not ready.")
            return

        future = self.arm_client.call_async(CommandBool.Request(value=value))
        future.add_done_callback(self.arm_response_callback)

    def mode_response_callback(self, future, requested_mode):
        try:
            response = future.result()
            self.get_logger().info(
                f"{requested_mode} mode response: mode_sent={response.mode_sent}"
            )
        except Exception as e:
            self.get_logger().error(f"SetMode service call failed: {e}")

    def arm_response_callback(self, future):
        try:
            response = future.result()
            self.get_logger().info(
                f"Arming response: success={response.success}, result={response.result}"
            )
        except Exception as e:
            self.get_logger().error(f"Arming service call failed: {e}")

    def settings_callback(self, msg):
        """ Callback to update mission parameters received from the frontend as JSON. """
        try:
            data = json.loads(msg.data)

            if 'takeoffAltitude' in data:
                self.takeoff_alt = float(data['takeoffAltitude'])

            if 'hoverTime' in data:
                self.hover_time = float(data['hoverTime'])

            if 'cruiseSpeed' in data:
                self.cruise_speed = float(data['cruiseSpeed'])
                # Adjust PX4 parameters to limit horizontal speed
                self.set_px4_param('MPC_XY_CRUISE', self.cruise_speed)
                self.set_px4_param('MPC_XY_VEL_MAX', self.cruise_speed)

            if 'autoRtl' in data:
                self.auto_rtl = bool(data['autoRtl'])

            self.get_logger().info(
                f"Settings synced: Alt={self.takeoff_alt}, "
                f"Speed={self.cruise_speed}, AutoRTL={self.auto_rtl}"
            )
        except Exception as e:
            self.get_logger().error(f"Settings error: {e}")

    def waypoints_callback(self, msg):
        """ Callback to receive and buffer mission waypoints from the frontend. """
        self.custom_waypoints = []

        for pose in msg.poses:
            yaw = self.get_yaw_from_quaternion(pose.orientation)
            self.custom_waypoints.append(
                (pose.position.x, pose.position.y, pose.position.z, yaw)
            )

        self.get_logger().info(
            f"Buffered {len(self.custom_waypoints)} waypoints from UI."
        )

    def get_yaw_from_quaternion(self, q):
        """ Converts a quaternion orientation into a yaw angle in degrees. """
        siny_cosp = 2 * (q.w * q.z + q.x * q.y)
        cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z)
        return math.degrees(math.atan2(siny_cosp, cosy_cosp))

    def set_orientation_from_yaw(self, yaw_deg):
        """ Sets the target_pose orientation quaternion based on a desired yaw angle in degrees. """
        yaw_rad = math.radians(yaw_deg)

        self.target_pose.pose.orientation.w = math.cos(yaw_rad * 0.5)
        self.target_pose.pose.orientation.z = math.sin(yaw_rad * 0.5)
        self.target_pose.pose.orientation.x = 0.0
        self.target_pose.pose.orientation.y = 0.0

    def calc_bearing(self, tx, ty):
        """ Calculates the required heading (bearing) from the current position to the target waypoint. """
        dx = tx - self.current_pose.pose.position.x
        dy = ty - self.current_pose.pose.position.y

        if math.sqrt(dx**2 + dy**2) < 1.5:  # Do not change heading if distance is less than 1.5m
            return None

        return math.degrees(math.atan2(dy, dx))

    def is_at_target(self, xy_tol=0.25, z_tol=0.2, yaw_tol=10.0):
        """ Checks if the drone has reached the current target_pose within specified tolerances. """
        dx = self.target_pose.pose.position.x - self.current_pose.pose.position.x
        dy = self.target_pose.pose.position.y - self.current_pose.pose.position.y
        dz = self.target_pose.pose.position.z - self.current_pose.pose.position.z

        xy_dist = math.sqrt(dx**2 + dy**2)
        z_dist = abs(dz)

        curr_yaw = self.get_yaw_from_quaternion(self.current_pose.pose.orientation)
        targ_yaw = self.get_yaw_from_quaternion(self.target_pose.pose.orientation)

        # Calculate shortest path yaw error
        yaw_err = abs((targ_yaw - curr_yaw + 180) % 360 - 180)

        return xy_dist < xy_tol and z_dist < z_tol and yaw_err < yaw_tol

    def timer_callback(self):
        """ 
        Main state machine loop running at 20Hz. 
        It controls the flow from IDLE -> ARMING -> TAKEOFF -> WAIT_CONFIRM -> MISSION -> HOVER.
        It also ensures target_pose is continuously published to maintain OFFBOARD control.
        """
        if not self.current_state.connected:
            return

        # Log state transitions
        if self.mission_state != self.last_state:
            self.get_logger().info(
                f"Transition: {self.last_state} -> {self.mission_state}"
            )
            self.last_state = self.mission_state
            self.state_start_time = self.get_clock().now()

        # =========================================================
        # State: IDLE
        # Waiting on the ground for a mission start command
        # =========================================================
        if self.mission_state == self.STATE_IDLE:
            if self.mission_started:
                self.init_setpoint_count = 0
                self.mission_state = self.STATE_ARMING
                self.mission_started = False

                # Record origin to use as a local reference point
                self.mission_origin = (
                    self.current_pose.pose.position.x,
                    self.current_pose.pose.position.y
                )
                self.mission_origin_z = self.current_pose.pose.position.z
                self.takeoff_target_z = self.mission_origin_z + float(self.takeoff_alt)

                # Initialize target to the current position
                self.target_pose.pose.position.x = self.current_pose.pose.position.x
                self.target_pose.pose.position.y = self.current_pose.pose.position.y
                self.target_pose.pose.position.z = self.current_pose.pose.position.z

                self.target_pose.pose.orientation.x = self.current_pose.pose.orientation.x
                self.target_pose.pose.orientation.y = self.current_pose.pose.orientation.y
                self.target_pose.pose.orientation.z = self.current_pose.pose.orientation.z
                self.target_pose.pose.orientation.w = self.current_pose.pose.orientation.w

        # =========================================================
        # State: ARMING
        # Preparing to arm and switching to OFFBOARD mode
        # =========================================================
        elif self.mission_state == self.STATE_ARMING:
            # PX4 requires a steady stream of setpoints before allowing OFFBOARD mode
            if self.init_setpoint_count < 40:
                self.init_setpoint_count += 1
            else:
                now = self.get_clock().now()

                # Request OFFBOARD mode and Arm the drone periodically (every 1 second)
                if now - self.last_request_time > rclpy.duration.Duration(seconds=1.0):
                    if self.current_state.mode != "OFFBOARD":
                        self.get_logger().info("Requesting OFFBOARD mode...")
                        self.set_mode("OFFBOARD")
                    elif not self.current_state.armed:
                        self.get_logger().info("Requesting arm...")
                        self.arm(True)

                    self.last_request_time = now

                # Proceed to TAKEOFF once successfully armed and in OFFBOARD mode
                if self.current_state.mode == "OFFBOARD" and self.current_state.armed:
                    self.get_logger().info(
                        f"Taking off to {self.takeoff_alt}m above start position."
                    )
                    self.mission_state = self.STATE_TAKEOFF

        # =========================================================
        # State: TAKEOFF
        # Ascending to the target altitude
        # =========================================================
        elif self.mission_state == self.STATE_TAKEOFF:
            # Command drone to ascend to the target altitude at current horizontal position
            self.target_pose.pose.position.x = self.mission_origin[0]
            self.target_pose.pose.position.y = self.mission_origin[1]
            self.target_pose.pose.position.z = self.takeoff_target_z

            # Check if takeoff altitude is reached (with a 0.3m tolerance)
            if self.current_pose.pose.position.z >= self.takeoff_target_z - 0.3:
                self.get_logger().info(
                    f"Takeoff target altitude of {self.takeoff_alt}m reached."
                )
                self.mission_state = self.STATE_WAIT_CONFIRM
                self.mission_confirmed = False

        # =========================================================
        # State: WAIT_CONFIRM
        # Waiting for user confirmation before starting mission
        # =========================================================
        elif self.mission_state == self.STATE_WAIT_CONFIRM:
            # Wait for user confirmation from UI before proceeding with the mission
            self.target_pose.pose.position.x = self.mission_origin[0]
            self.target_pose.pose.position.y = self.mission_origin[1]
            self.target_pose.pose.position.z = self.takeoff_target_z

            if self.mission_confirmed:
                if self.current_state.mode == "OFFBOARD":
                    self.mission_state = self.STATE_MISSION
                    self.current_wp_idx = 0
                    self.set_next_waypoint() # Set the first waypoint

        # =========================================================
        # State: MISSION
        # Executing the waypoint mission
        # =========================================================
        elif self.mission_state == self.STATE_MISSION:
            # If target reached, hover for the specified time before moving to the next waypoint
            if self.is_at_target():
                elapsed = self.get_clock().now() - self.state_start_time

                # Load next waypoint once hover time has elapsed
                if elapsed > rclpy.duration.Duration(seconds=self.hover_time):
                    self.current_wp_idx += 1

                    # If no more waypoints (set_next_waypoint returns False), mission is complete
                    if not self.set_next_waypoint():
                        if self.auto_rtl:
                            self.get_logger().info(
                                "Mission Complete. Triggering Auto RTL..."
                            )
                            self.set_mode("AUTO.RTL")
                        else:
                            self.get_logger().info(
                                "Mission Complete. Hovering at last position."
                            )

                        self.mission_state = self.STATE_HOVER
            else:
                wp = self.get_current_wp_data()

                # Automatically face the target if a specific yaw (0.0) is not set by the user
                if wp and wp[3] == 0.0:
                    bearing = self.calc_bearing(
                        self.target_pose.pose.position.x,
                        self.target_pose.pose.position.y
                    )
                    if bearing is not None:
                        self.set_orientation_from_yaw(bearing)

                # Keep resetting the start time as long as we are still travelling to the target
                self.state_start_time = self.get_clock().now()

        # =========================================================
        # State: HOVER
        # Hovering in place after mission completion or while waiting
        # =========================================================
        elif self.mission_state == self.STATE_HOVER:
            # Hover indefinitely until disarmed (which resets state to IDLE)
            if not self.current_state.armed:
                self.mission_state = self.STATE_IDLE

        # --- Failsafe Checks ---
        active_offboard_states = [
            self.STATE_TAKEOFF,
            self.STATE_WAIT_CONFIRM,
            self.STATE_MISSION,
            self.STATE_HOVER,
        ]

        # Failsafe: Revert to IDLE immediately if drone gets disarmed mid-flight
        if self.mission_state in active_offboard_states and not self.current_state.armed:
            self.get_logger().warn("Vehicle disarmed during mission. Aborting to IDLE.")
            self.mission_state = self.STATE_IDLE

        # Failsafe: Abort mission if mode is switched away from OFFBOARD (e.g. by RC switch)
        if self.mission_state in active_offboard_states and self.current_state.mode != "OFFBOARD":
            if not (
                self.mission_state == self.STATE_HOVER
                and self.current_state.mode in ["AUTO.RTL", "AUTO.LOITER", "AUTO.LAND"]
            ):
                self.get_logger().warn(
                    f"Manual mode change detected ({self.current_state.mode}) "
                    "during mission! Aborting to IDLE."
                )
                self.mission_state = self.STATE_IDLE

        # --- Setpoint Publishing ---
        # Continuous setpoint publishing is required by PX4 to stay in OFFBOARD mode
        if self.mission_state != self.STATE_IDLE:
            self.target_pose.header.stamp = self.get_clock().now().to_msg()
            self.pose_pub.publish(self.target_pose)

    def set_next_waypoint(self):
        """ Updates target_pose to point to the next waypoint in the list. """
        wps = self.custom_waypoints

        if self.current_wp_idx >= len(wps):
            return False

        x, y, z, yaw = wps[self.current_wp_idx]

        # Apply x,y offsets relative to the origin
        self.target_pose.pose.position.x = self.mission_origin[0] + x
        self.target_pose.pose.position.y = self.mission_origin[1] + y
        self.target_pose.pose.position.z = z

        # If a yaw is specified use it; otherwise auto-calculate heading towards the target
        if yaw != 0.0:
            self.set_orientation_from_yaw(yaw)
        else:
            bearing = self.calc_bearing(
                self.target_pose.pose.position.x,
                self.target_pose.pose.position.y
            )
            if bearing is not None:
                self.set_orientation_from_yaw(bearing)

        return True

    def get_current_wp_data(self):
        """ Helper to retrieve data for the current waypoint. """
        wps = self.custom_waypoints

        if self.current_wp_idx < len(wps):
            return wps[self.current_wp_idx]

        return None

    def set_px4_param(self, pid, val):
        """ Helper to set PX4 internal parameters (like cruise speed). """
        req = SetParameters.Request()
        param = Parameter(
            name=pid,
            value=ParameterValue(
                type=ParameterType.PARAMETER_DOUBLE,
                double_value=float(val)
            )
        )
        req.parameters = [param]
        self.param_set_client.call_async(req)


def main(args=None):
    rclpy.init(args=args)
    node = OffboardControl()

    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()


if __name__ == '__main__':
    main()