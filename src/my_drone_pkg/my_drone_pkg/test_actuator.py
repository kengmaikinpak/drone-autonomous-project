import rclpy
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
from mavros_msgs.msg import State, AttitudeTarget
from mavros_msgs.srv import CommandBool, SetMode
from geometry_msgs.msg import Quaternion
import time

class OffboardMotorTest(Node):
    def __init__(self):
        super().__init__('offboard_motor_test_node')

        # --- Parameters ---
        self.RAMP_UP_DURATION = 5.0 # Ramp up duration
        self.HOVER_TEST_DURATION = 5.0  # Run motors for 5 seconds
        self.LAND_DURATION = 10.0   # Ramp down duration
        self.HOVER_TEST_THRUST = 0.74    # 0.63 = ~63% Thrust get start hover
                                  # WARNING: Increase with caution!

        # --- Publishers & Subscribers ---
        self.attitude_pub = self.create_publisher(AttitudeTarget, '/mavros/setpoint_raw/attitude', 10)
        
        # QoS for State (Match MAVROS default)
        self.state_sub = self.create_subscription(State, '/mavros/state', self.state_callback, 10)

        # --- Service Clients ---
        self.arm_client = self.create_client(CommandBool, '/mavros/cmd/arming')
        self.set_mode_client = self.create_client(SetMode, '/mavros/set_mode')

        # --- Internal State ---
        self.current_state = State()
        self.start_time = None
        self.is_armed_and_offboard = False
        
        # Timer for control loop (20Hz)
        self.timer = self.create_timer(0.05, self.control_loop)
        
        self.get_logger().info("Offboard Motor Test Node Started")
        self.get_logger().info(f"Target Thrust: {self.HOVER_TEST_THRUST}")
        self.get_logger().info(f"Test Duration: {self.HOVER_TEST_DURATION}s, Land Duration: {self.LAND_DURATION}s")

    def state_callback(self, msg):
        self.current_state = msg

    def set_arm(self, arm=True):
        if self.current_state.armed == arm:
            return
            
        req = CommandBool.Request()
        req.value = arm
        future = self.arm_client.call_async(req)
        future.add_done_callback(lambda future: self.get_logger().info(f"Arming Result: {future.result().success}"))

    def set_offboard_mode(self):
        if self.current_state.mode == "OFFBOARD":
            return

        req = SetMode.Request()
        req.custom_mode = "OFFBOARD"
        future = self.set_mode_client.call_async(req)
        future.add_done_callback(lambda future: self.get_logger().info(f"Set Mode Result: {future.result().mode_sent}"))

    def control_loop(self):
        # 1. Check Connection
        if not self.current_state.connected:
            self.get_logger().info("Waiting for MAVROS connection...", throttle_duration_sec=2.0)
            return

        # 2. Prepare Attitude Target Message (Setpoint)
        msg = AttitudeTarget()
        msg.header.stamp = self.get_clock().now().to_msg()
        msg.type_mask = 128  # Ignore Body Rate (Use Orientation + Thrust)
        
        # Orientation: Flat (Identity Quaternion) -> w=1, x=0, y=0, z=0
        msg.orientation = Quaternion(w=1.0, x=0.0, y=0.0, z=0.0)
        
        # Default Thrust (Idle)
        msg.thrust = 0.0

        # 3. State Machine Logic
        if not self.is_armed_and_offboard:
            # Keep sending setpoints to allow switching to OFFBOARD
            msg.thrust = 0.0
            self.attitude_pub.publish(msg)

            # Try to switch to OFFBOARD and ARM
            # Note: PX4 requires streaming setpoints for > 1s before allowing OFFBOARD mode
            if self.current_state.mode != "OFFBOARD":
                self.set_offboard_mode()
            elif not self.current_state.armed:
                self.set_arm(True)
            else:
                self.is_armed_and_offboard = True
                self.start_time = self.get_clock().now()
                self.get_logger().info("OFFBOARD Enabled & Armed! Starting Motor Test...")
        
        else:
            # 4. Run Test
            now = self.get_clock().now()
            elapsed = (now - self.start_time).nanoseconds / 1e9
            
            if elapsed < self.RAMP_UP_DURATION:
                # Phase 1: Ramp Up (Takeoff)
                progress = elapsed / self.RAMP_UP_DURATION
                current_thrust = self.HOVER_TEST_THRUST * progress

                msg.thrust = current_thrust
                self.attitude_pub.publish(msg)
                self.get_logger().info(f"Ramp Up... Thrust: {current_thrust:.2f}", throttle_duration_sec=0.5)

            elif elapsed < (self.RAMP_UP_DURATION + self.HOVER_TEST_DURATION):
                # Phase 2: Constant Thrust (Hold)
                msg.thrust = self.HOVER_TEST_THRUST
                # msg.thrust = self.HOVER_TEST_THRUST
                self.attitude_pub.publish(msg)
                
                remaining = (self.RAMP_UP_DURATION + self.HOVER_TEST_DURATION) - elapsed
                self.get_logger().info(f"Running Motors... Time Remaining: {remaining:.1f}s", throttle_duration_sec=1.0)
            
            elif elapsed < (self.RAMP_UP_DURATION + self.HOVER_TEST_DURATION + self.LAND_DURATION):
                # Phase 3: Ramp Down (Landing)
                ramp_down_elapsed = elapsed - (self.RAMP_UP_DURATION + self.HOVER_TEST_DURATION)
                progress = ramp_down_elapsed / self.LAND_DURATION
                
                # Linear interpolation from HOVER_TEST_THRUST to 0.0
                current_thrust = self.HOVER_TEST_THRUST * (1.0 - progress)
                
                msg.thrust = max(0.0, current_thrust)
                self.attitude_pub.publish(msg)
                
                self.get_logger().info(f"Landing (Ramp Down)... Thrust: {current_thrust:.2f}", throttle_duration_sec=0.5)
            
            else:
                # 5. Test Complete
                self.get_logger().info("Test Duration Complete. Stopping...")
                msg.thrust = 0.0
                self.attitude_pub.publish(msg)
                
                # Disarm and Exit
                if self.current_state.armed:
                    self.set_arm(False)
                
                if not self.current_state.armed:
                   self.get_logger().info("Disarmed. Test Finished.")
                   # Use a system exit or just stop publishing high thrust
                   rclpy.shutdown() # Optional: Shutdown node logic if desired

def main(args=None):
    rclpy.init(args=args)
    node = OffboardMotorTest()
    
    try:
        rclpy.spin(node)
    except KeyboardInterrupt:
        pass
    finally:
        node.destroy_node()
        rclpy.shutdown()

if __name__ == '__main__':
    main()