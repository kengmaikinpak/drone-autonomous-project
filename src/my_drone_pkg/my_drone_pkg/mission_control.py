import rclpy
import math
import json
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
from mavros_msgs.msg import State
from mavros_msgs.srv import CommandBool, SetMode, CommandTOL
from geometry_msgs.msg import PoseStamped, PoseArray
from std_srvs.srv import Trigger
from std_msgs.msg import String
from rcl_interfaces.srv import SetParameters
from rcl_interfaces.msg import Parameter, ParameterValue, ParameterType

class OffboardControl(Node):
    # Definition of States
    STATE_IDLE = "IDLE"
    STATE_ARMING = "ARMING"
    STATE_TAKEOFF = "TAKEOFF"
    STATE_WAIT_CONFIRM = "WAIT_CONFIRM"
    STATE_MISSION = "MISSION"
    STATE_HOVER = "HOVER"

    def __init__(self):
        super().__init__('offboard_control_node')
        
        # Service Clients
        self.arm_client = self.create_client(CommandBool, '/mavros/cmd/arming')
        self.set_mode_client = self.create_client(SetMode, '/mavros/set_mode')
        self.takeoff_client = self.create_client(CommandTOL, '/mavros/cmd/takeoff')
        self.param_set_client = self.create_client(SetParameters, '/mavros/param/set_parameters')
        
        # Publishers
        self.pose_pub = self.create_publisher(PoseStamped, '/mavros/setpoint_position/local', 10)
        
        # Subscribers
        self.pose_qos_profile = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
            history=HistoryPolicy.KEEP_LAST,
            depth=10
        )
        self.state_sub = self.create_subscription(State, '/mavros/state', self.state_callback, 10)
        self.pose_sub = self.create_subscription(PoseStamped, '/mavros/local_position/pose', self.pose_callback, self.pose_qos_profile)
        
        # UI Communication
        self.srv_start_mission = self.create_service(Trigger, '/mission/start', self.start_mission_callback)
        self.srv_confirm_waypoint = self.create_service(Trigger, '/mission/confirm_waypoint', self.confirm_waypoint_callback)
        self.settings_sub = self.create_subscription(String, '/mission/settings', self.settings_callback, 10)
        self.waypoints_sub = self.create_subscription(PoseArray, '/mission/waypoints', self.waypoints_callback, 10)

        # Variables
        self.current_state = State()
        self.current_pose = PoseStamped()
        self.target_pose = PoseStamped()
        self.target_pose.header.frame_id = "odom"
        
        self.mission_state = self.STATE_IDLE
        self.last_state = self.STATE_IDLE
        self.mission_started = False
        self.mission_confirmed = False
        
        self.takeoff_alt = 3.0
        self.hover_time = 5.0
        self.cruise_speed = 5.0
        self.auto_rtl = False
        self.custom_waypoints = []
        self.current_wp_idx = 0
        self.mission_origin = (0.0, 0.0)
        self.takeoff_setpoint_z = 0.0
        self.takeoff_service_called = False
        
        self.last_request_time = self.get_clock().now()
        self.state_start_time = self.get_clock().now()
        self.init_setpoint_count = 0
        
        # Main Timer (20Hz) - Non-blocking execution
        self.timer = self.create_timer(0.05, self.timer_callback)
        self.get_logger().info("Mission Control Node (State Machine) started.")

    def state_callback(self, msg):
        self.current_state = msg

    def pose_callback(self, msg):
        self.current_pose = msg

    def start_mission_callback(self, request, response):
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
        if self.mission_state == self.STATE_WAIT_CONFIRM:
            self.mission_confirmed = True
            response.success = True
            response.message = "Go to waypoint confirmed."
        else:
            response.success = False
            response.message = "Not in WAITING state."
        return response

    def settings_callback(self, msg):
        try:
            data = json.loads(msg.data)
            if 'takeoffAltitude' in data: self.takeoff_alt = float(data['takeoffAltitude'])
            if 'hoverTime' in data: self.hover_time = float(data['hoverTime'])
            if 'cruiseSpeed' in data:
                self.cruise_speed = float(data['cruiseSpeed'])
                self.set_px4_param('MPC_XY_CRUISE', self.cruise_speed)
                self.set_px4_param('MPC_XY_VEL_MAX', self.cruise_speed)
            if 'autoRtl' in data: 
                self.auto_rtl = bool(data['autoRtl'])
            self.get_logger().info(f"Settings synced: Alt={self.takeoff_alt}, Speed={self.cruise_speed}, AutoRTL={self.auto_rtl}")
        except Exception as e:
            self.get_logger().error(f"Settings error: {e}")

    def waypoints_callback(self, msg):
        self.custom_waypoints = []
        for pose in msg.poses:
            yaw = self.get_yaw_from_quaternion(pose.orientation)
            self.custom_waypoints.append((pose.position.x, pose.position.y, pose.position.z, yaw))
        self.get_logger().info(f"Buffered {len(self.custom_waypoints)} waypoints from UI.")

    def get_yaw_from_quaternion(self, q):
        siny_cosp = 2 * (q.w * q.z + q.x * q.y)
        cosy_cosp = 1 - 2 * (q.y * q.y + q.z * q.z)
        return math.degrees(math.atan2(siny_cosp, cosy_cosp))

    def set_orientation_from_yaw(self, yaw_deg):
        yaw_rad = math.radians(yaw_deg)
        self.target_pose.pose.orientation.w = math.cos(yaw_rad * 0.5)
        self.target_pose.pose.orientation.z = math.sin(yaw_rad * 0.5)
        self.target_pose.pose.orientation.x = 0.0
        self.target_pose.pose.orientation.y = 0.0

    def calc_bearing(self, tx, ty):
        dx = tx - self.current_pose.pose.position.x
        dy = ty - self.current_pose.pose.position.y
        # Stop updating bearing if we are within 1.5 meters to prevent spinning around if we overshoot
        if math.sqrt(dx**2 + dy**2) < 1.5: return None
        return math.degrees(math.atan2(dy, dx))

    def is_at_target(self, xy_tol=0.25, z_tol=0.2, yaw_tol=10.0):
        dx = self.target_pose.pose.position.x - self.current_pose.pose.position.x
        dy = self.target_pose.pose.position.y - self.current_pose.pose.position.y
        dz = self.target_pose.pose.position.z - self.current_pose.pose.position.z
        xy_dist = math.sqrt(dx**2 + dy**2)
        z_dist = abs(dz)
        
        curr_yaw = self.get_yaw_from_quaternion(self.current_pose.pose.orientation)
        targ_yaw = self.get_yaw_from_quaternion(self.target_pose.pose.orientation)
        yaw_err = abs((targ_yaw - curr_yaw + 180) % 360 - 180)
        
        return xy_dist < xy_tol and z_dist < z_tol and yaw_err < yaw_tol

    def timer_callback(self):
        if not self.current_state.connected: return

        if self.mission_state != self.last_state:
            self.get_logger().info(f"Transition: {self.last_state} -> {self.mission_state}")
            self.last_state = self.mission_state
            self.state_start_time = self.get_clock().now()

        # Logic per State
        if self.mission_state == self.STATE_IDLE:
            if self.mission_started:
                self.init_setpoint_count = 0
                self.mission_state = self.STATE_ARMING
                self.mission_started = False
                self.mission_origin = (self.current_pose.pose.position.x, self.current_pose.pose.position.y)
                # Snapshot current position and orientation for arming phase
                self.target_pose.pose.position.x = self.current_pose.pose.position.x
                self.target_pose.pose.position.y = self.current_pose.pose.position.y
                self.target_pose.pose.position.z = self.current_pose.pose.position.z
                self.target_pose.pose.orientation.x = self.current_pose.pose.orientation.x
                self.target_pose.pose.orientation.y = self.current_pose.pose.orientation.y
                self.target_pose.pose.orientation.z = self.current_pose.pose.orientation.z
                self.target_pose.pose.orientation.w = self.current_pose.pose.orientation.w

        elif self.mission_state == self.STATE_ARMING:
            if self.init_setpoint_count < 20:
                self.init_setpoint_count += 1
            else:
                now = self.get_clock().now()
                if now - self.last_request_time > rclpy.duration.Duration(seconds=1.0):
                    if not self.current_state.armed:
                        self.get_logger().info("Sending arm command...")
                        self.arm_client.call_async(CommandBool.Request(value=True))
                    self.last_request_time = now
                
                if self.current_state.armed:
                    self.mission_state = self.STATE_TAKEOFF
                    self.takeoff_service_called = False

        elif self.mission_state == self.STATE_TAKEOFF:
            # Keep streaming current position to ensure setpoint pipeline stays active
            self.target_pose.pose.position.x = self.current_pose.pose.position.x
            self.target_pose.pose.position.y = self.current_pose.pose.position.y
            self.target_pose.pose.position.z = self.current_pose.pose.position.z
            self.target_pose.pose.orientation.x = self.current_pose.pose.orientation.x
            self.target_pose.pose.orientation.y = self.current_pose.pose.orientation.y
            self.target_pose.pose.orientation.z = self.current_pose.pose.orientation.z
            self.target_pose.pose.orientation.w = self.current_pose.pose.orientation.w
            
            if not self.takeoff_service_called:
                now = self.get_clock().now()
                if now - self.last_request_time > rclpy.duration.Duration(seconds=1.0):
                    self.get_logger().info("Calling MAVROS takeoff service...")
                    req = CommandTOL.Request()
                    req.altitude = float(self.takeoff_alt)
                    req.latitude = float('nan')
                    req.longitude = float('nan')
                    req.min_pitch = 0.0
                    req.yaw = float('nan')
                    self.takeoff_client.call_async(req)
                    self.takeoff_service_called = True
                    self.last_request_time = now
                
            # Transition only when reached takeoff altitude (using relative alt tolerance)
            if self.current_pose.pose.position.z >= (self.takeoff_alt - 0.5):
                self.get_logger().info(f"Takeoff target altitude of {self.takeoff_alt}m reached via service.")
                self.mission_state = self.STATE_WAIT_CONFIRM
                self.mission_confirmed = False

        elif self.mission_state == self.STATE_WAIT_CONFIRM:
            # Hold the takeoff position
            self.target_pose.pose.position.x = self.mission_origin[0]
            self.target_pose.pose.position.y = self.mission_origin[1]
            self.target_pose.pose.position.z = float(self.takeoff_alt)
            # Orientation remains what was snapshotted previously
            
            if self.mission_confirmed:
                now = self.get_clock().now()
                if now - self.last_request_time > rclpy.duration.Duration(seconds=1.0):
                    if self.current_state.mode != "OFFBOARD":
                        self.get_logger().info("Switching mode to OFFBOARD mid-air...")
                        self.set_mode_client.call_async(SetMode.Request(custom_mode="OFFBOARD"))
                    self.last_request_time = now
                
                if self.current_state.mode == "OFFBOARD":
                    self.mission_state = self.STATE_MISSION
                    self.current_wp_idx = 0
                    self.set_next_waypoint()

        elif self.mission_state == self.STATE_MISSION:
            if self.is_at_target():
                elapsed = self.get_clock().now() - self.state_start_time
                if elapsed > rclpy.duration.Duration(seconds=self.hover_time):
                    self.current_wp_idx += 1
                    if not self.set_next_waypoint():
                        if self.auto_rtl:
                            self.get_logger().info("Mission Complete. Triggering Auto RTL...")
                            self.set_mode_client.call_async(SetMode.Request(custom_mode="AUTO.RTL"))
                        else:
                            self.get_logger().info("Mission Complete. Hovering at last position.")
                        self.mission_state = self.STATE_HOVER
            else:
                # Update yaw if waypoint has no specific yaw (auto-bearing)
                wp = self.get_current_wp_data()
                if wp and wp[3] == 0.0:
                    bearing = self.calc_bearing(self.target_pose.pose.position.x, self.target_pose.pose.position.y)
                    if bearing is not None: self.set_orientation_from_yaw(bearing)
                # Reset hover start time until target reached
                self.state_start_time = self.get_clock().now()

        elif self.mission_state == self.STATE_HOVER:
            if not self.current_state.armed:
                self.mission_state = self.STATE_IDLE

        # Security check: abort if mode changes manually during active mission or hover
        if self.mission_state in [self.STATE_MISSION, self.STATE_HOVER] and self.current_state.mode != "OFFBOARD":
            if not (self.mission_state == self.STATE_HOVER and self.current_state.mode in ["AUTO.RTL", "AUTO.LOITER", "AUTO.LAND"]):
                self.get_logger().warn(f"Manual mode change detected ({self.current_state.mode}) during mission! Aborting to IDLE.")
                self.mission_state = self.STATE_IDLE

        # Setpoint Publishing
        if self.mission_state != self.STATE_IDLE:
            self.target_pose.header.stamp = self.get_clock().now().to_msg()
            self.pose_pub.publish(self.target_pose)

    def set_next_waypoint(self):
        wps = self.custom_waypoints
        if self.current_wp_idx >= len(wps): return False
        
        x, y, z, yaw = wps[self.current_wp_idx]
        self.target_pose.pose.position.x = self.mission_origin[0] + x
        self.target_pose.pose.position.y = self.mission_origin[1] + y
        self.target_pose.pose.position.z = z
        
        if yaw != 0.0:
            self.set_orientation_from_yaw(yaw)
        else:
            bearing = self.calc_bearing(self.target_pose.pose.position.x, self.target_pose.pose.position.y)
            if bearing is not None: self.set_orientation_from_yaw(bearing)
        return True

    def get_current_wp_data(self):
        wps = self.custom_waypoints
        return wps[self.current_wp_idx] if self.current_wp_idx < len(wps) else None

    def set_px4_param(self, pid, val):
        req = SetParameters.Request()
        param = Parameter(name=pid, value=ParameterValue(type=ParameterType.PARAMETER_DOUBLE, double_value=float(val)))
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