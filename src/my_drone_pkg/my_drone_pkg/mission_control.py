import rclpy
import math
from rclpy.node import Node
from rclpy.clock import Clock
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
from mavros_msgs.msg import State # สถานะของโดรน
from mavros_msgs.srv import CommandBool, SetMode # บริการสั่ง arm และ Set Mode
from geometry_msgs.msg import PoseStamped, PoseArray # ข้อมูลตำแหน่ง
from std_srvs.srv import Trigger # Service สำหรับ Trigger

import numpy as np

class OffboardControl(Node):
    def __init__(self):
        super().__init__('offboard_control_node')
        
        # สร้าง Clients สำหรับเรียก Services
        self.arm_client = self.create_client(CommandBool, '/mavros/cmd/arming')
        self.set_mode_client = self.create_client(SetMode, '/mavros/set_mode')
        
        # สร้าง Publisher
        self.pose_pub = self.create_publisher(PoseStamped, '/mavros/setpoint_position/local', 10)
        
        # สร้าง Subscriber
        self.state_sub = self.create_subscription(State, '/mavros/state', self.state_callback, 10)

        # สร้าง Service Server สำหรับสั่งเริ่มภารกิจ
        self.srv_start_mission = self.create_service(Trigger, '/mission/start', self.start_mission_callback)
        self.mission_started = False
        
        # Subscriber สำหรับรับ waypoints จาก Web UI
        self.waypoints_sub = self.create_subscription(
            PoseArray, '/mission/waypoints', self.waypoints_callback, 10)
        self.custom_waypoints = None  # เก็บ waypoints ที่รับจาก Web UI
        
        # --- 1. สร้างโปรไฟล์ QoS ที่เข้ากันได้กับ Best Effort ---
        # เราใช้ Durability=Volatile เพราะข้อมูลตำแหน่งเป็นข้อมูล realtime ไม่ต้องเก็บของเก่า
        self.pose_qos_profile = QoSProfile(
            reliability=ReliabilityPolicy.BEST_EFFORT,
            durability=DurabilityPolicy.VOLATILE,
            history=HistoryPolicy.KEEP_LAST,
            depth=10  # เก็บ 10 ข้อความล่าสุดก็พอ
        )

        # --- 2. ใช้โปรไฟล์ QoS นี้ในการสร้าง Subscriber ---
        self.pose_sub = self.create_subscription(
            PoseStamped, 
            '/mavros/local_position/pose', 
            self.pose_callback, 
            self.pose_qos_profile # <-- ใช้โปรไฟล์ใหม่นี้แทนเลข 10
        )
        
        # ตัวแปรเก็บสถานะปัจจุบันและตำแหน่งปัจจุบัน
        self.current_state = State()
        self.current_pose = PoseStamped()
        
        # ตัวแปรเก็บเป้าหมายตำแหน่ง
        self.target_pose = PoseStamped()
        
        self.get_logger().info("Node started. Waiting for MAVROS connection...")

    def state_callback(self, msg):
        """
        callback เพื่ออัพเดทสถานะปัจจุบันของโดรน (mavros/state)
        """
        self.current_state = msg

    def pose_callback(self, msg):
        """
        callback เพื่ออัพเดทตำแหน่งปัจจุบันของโดรน (local_position/pose)
        """
        self.current_pose = msg

    def is_at_target_position(self, tolerance=0.2):
        """
        ตรวจสอบว่าตำแหน่งปัจจุบัน (current_pose) อยู่ใกล้เป้าหมาย (target_pose)
        ในระยะที่กำหนด (tolerance) หรือไม่
        """        
        # คำนวณระยะห่างแบบ 3D (Euclidean distance)
        dx = self.target_pose.pose.position.x - self.current_pose.pose.position.x
        dy = self.target_pose.pose.position.y - self.current_pose.pose.position.y
        dz = self.target_pose.pose.position.z - self.current_pose.pose.position.z
        distance = math.sqrt(dx**2 + dy**2 + dz**2)
        return distance < tolerance # คืนค่า True ถ้าอยู่ในระยะ 0.5 เมตร

    def set_orientation_from_yaw(self, yaw_deg):
        """
        สร้าง Quaternion จากมุม Yaw (องศา)
        และอัปเดต self.target_pose.orientation
        """
        # แปลงองศาเป็นเรเดียน
        yaw_rad = math.radians(yaw_deg)
        
        # คำนวณ Quaternion (สำหรับ Yaw ล้วนๆ)
        cy = math.cos(yaw_rad * 0.5)
        sy = math.sin(yaw_rad * 0.5)
        
        # ตั้งค่า Orientation
        self.target_pose.pose.orientation.w = cy
        self.target_pose.pose.orientation.x = 0.0
        self.target_pose.pose.orientation.y = 0.0
        self.target_pose.pose.orientation.z = sy

    def mode_response_callback(self, future):
        try:
            response = future.result()
            self.get_logger().info(f"OFFBOARD mode response: {response.mode_sent}")
        except Exception as e:
            self.get_logger().error(f"Service call failed: {e}")

    def arm_response_callback(self, future):
        try:
            response = future.result()
            self.get_logger().info(f"Arming response: success={response.success}, result={response.result}")
        except Exception as e:
            self.get_logger().error(f"Service call failed: {e}")

    def start_mission_callback(self, request, response):
        """
        Callback เมื่อเรียก Service /mission/start
        """
        self.mission_started = True
        self.get_logger().info("Mission Manual Start Triggered!")
        response.success = True
        response.message = "Mission Started"
        return response
    
    def waypoints_callback(self, msg):
        """
        Callback เมื่อได้รับ waypoints จาก Web UI
        """
        self.custom_waypoints = []
        for pose in msg.poses:
            x = pose.position.x
            y = pose.position.y
            z = pose.position.z
            # ไม่มี yaw ใน PoseArray ปกติ ใช้ 0.0 เป็นค่าเริ่มต้น
            yaw = 0.0
            self.custom_waypoints.append((x, y, z, yaw))
        
        self.get_logger().info(f"Received {len(self.custom_waypoints)} waypoints from Web UI: {self.custom_waypoints}")

    # ---------------------------------------
    # ฟังก์ชันหลักในการรันภารกิจ
    # ---------------------------------------
    
    def run_mission(self):
        # รอการเชื่อมต่อกับ MAVROS (ทำครั้งเดียวตอนเริ่ม Node)
        while not self.current_state.connected:
            rclpy.spin_once(self)
            self.get_logger().info("Waiting for connection to MAVROS...")
        self.get_logger().info("MAVROS connected!")

        # Loop หลักเพื่อให้สามารถรับภารกิจได้เรื่อยๆ
        while rclpy.ok():
            self.get_logger().info("Ready for new Mission (Waiting for Command)...")
            self.mission_started = False
            # รอคำสั่ง Start Mission
            self.get_logger().info("Waiting for 'Start Mission' command via /mission/start service...")
            wait_count = 0
            while not self.mission_started and rclpy.ok():
                rclpy.spin_once(self, timeout_sec=0.1)
                wait_count += 1
                if wait_count % 50 == 0:
                    self.get_logger().info(f"Waiting for start command... (Mode: {self.current_state.mode}, Armed: {self.current_state.armed})")
            
            if not rclpy.ok():
                break
                
            self.get_logger().info("Start command received! Proceeding to takeoff...")

            # ส่ง setpoints ก่อนเปลี่ยนโหมด (อย่างน้อย 100 ครั้ง)(ให้ผ่านเช็ค QoS)
            # ใช้ตำแหน่งปัจจุบันเป็นจุดเริ่มต้นเพื่อความปลอดภัย (กันการลากพื้นในการบินรอบถัดๆไป)
            self.target_pose = PoseStamped()
            self.target_pose.header.frame_id = "map"
            self.target_pose.pose.position.x = self.current_pose.pose.position.x
            self.target_pose.pose.position.y = self.current_pose.pose.position.y
            self.target_pose.pose.position.z = self.current_pose.pose.position.z
            
            for _ in range(100):
                self.target_pose.header.stamp = self.get_clock().now().to_msg()
                self.pose_pub.publish(self.target_pose)
                rclpy.spin_once(self, timeout_sec=0.05)
                # self.get_logger().info("Sending initial setpoints...")
            self.get_logger().info("Initial setpoints sent.")
            
            # เปลี่ยนโหมดเป็น OFFBOARD และ Arm โดรน
            set_mode_req = SetMode.Request()
            set_mode_req.custom_mode = "OFFBOARD"
            arm_req = CommandBool.Request()
            arm_req.value = True
            last_request_time = self.get_clock().now()
            
            while rclpy.ok():
                if self.get_clock().now() - last_request_time > rclpy.duration.Duration(seconds=1.0): # ทุกๆ 1 วินาที
                    if self.current_state.mode != "OFFBOARD":
                        self.get_logger().info("Requesting OFFBOARD mode...")
                        future_mode = self.set_mode_client.call_async(set_mode_req)
                        future_mode.add_done_callback(self.mode_response_callback)
                    else:
                        # ถ้าเปลี่ยนโหมดสำเร็จแล้ว ถึงจะลอง Arm
                        if not self.current_state.armed:
                            self.get_logger().info("Requesting Arming...")
                            future_arm = self.arm_client.call_async(arm_req)
                            future_arm.add_done_callback(self.arm_response_callback)

                    last_request_time = self.get_clock().now()

                if self.current_state.mode == "OFFBOARD" and self.current_state.armed:
                    self.get_logger().info("Drone is in OFFBOARD mode and armed.")
                    break
                
                # ส่ง setpoint ต่อเนื่องระหว่างรอ
                self.target_pose.header.stamp = self.get_clock().now().to_msg()
                self.pose_pub.publish(self.target_pose)
                rclpy.spin_once(self, timeout_sec=0.1)
                
            # ---------------------------------------
            # Mission Logic
            # ---------------------------------------
            
            # กำหนดลำดับ Waypoints
            # ใช้ waypoints จาก Web UI ถ้ามี ไม่งั้นใช้ค่าเริ่มต้น
            using_custom = bool(self.custom_waypoints and len(self.custom_waypoints) > 0)
            if using_custom:
                waypoints = self.custom_waypoints
                self.get_logger().info(f"Using custom waypoints from Web UI: {len(waypoints)} points (Absolute coordinates)")
            else:
                waypoints = [
                    (0.0, 0.0, 2.0, 0.0),    # 1. Takeoff (z=2, yaw=0)
                    (2.0, 0.0, 2.0, 0.0),    # 2. Forward (x=2, yaw=0)
                    (-2.0, 0.0, 2.0, 0.0),   # 3. Backward (x=-2, yaw=0)
                    (0.0, 0.0, 2.0, 0.0),    # 4. Center (x=0, yaw=0)
                    (0.0, -2.0, 2.0, 0.0),   # 5. Right (y=-2, yaw=0)
                    (0.0, 2.0, 2.0, 0.0),    # 6. Left (y=2, yaw=0)
                    (0.0, 0.0, 2.0, 0.0),    # 7. Center (x=0, yaw=0)
                    (0.0, 0.0, 2.0, 90.0),   # 8. Rotate (yaw=90)
                    (0.0, 0.0, 2.0, 0.0)     # 9. Rotate back (yaw=0)
                ]
                self.get_logger().info("Using default waypoints (Relative to mission start)")
            
            # --- ลูปภารกิจหลัก (Main Mission Loop) ---
            # Capture start position for relative waypoint calculation (default waypoints only)
            mission_start_x = self.current_pose.pose.position.x
            mission_start_y = self.current_pose.pose.position.y
            self.get_logger().info(f"Mission Start Origin: ({mission_start_x}, {mission_start_y})")

            # Timeout ต่อ Waypoint (วินาที)
            WAYPOINT_TIMEOUT_SEC = 30.0

            for idx, (x, y, z, yaw) in enumerate(waypoints):
                # Check exit condition at start of each waypoint
                if self.current_state.mode != "OFFBOARD" or not self.current_state.armed:
                    self.get_logger().info("Mission interrupted during waypoint loop.")
                    break

                # Custom waypoints จาก Web UI → ใช้พิกัด Absolute (map frame)
                # Default waypoints → ใช้พิกัด Relative จาก mission_start
                if using_custom:
                    self.target_pose.pose.position.x = x
                    self.target_pose.pose.position.y = y
                else:
                    self.target_pose.pose.position.x = mission_start_x + x
                    self.target_pose.pose.position.y = mission_start_y + y
                self.target_pose.pose.position.z = z
                self.set_orientation_from_yaw(yaw)
                
                self.get_logger().info(f"Heading to Waypoint {idx+1}: ({self.target_pose.pose.position.x}, {self.target_pose.pose.position.y}, {z}, {yaw} degrees)")
                
                # ลูป "ไปที่เป้าหมาย" (Go-to Loop)
                wp_start_time = self.get_clock().now()
                while rclpy.ok():
                    # Check exit condition during flight
                    if self.current_state.mode != "OFFBOARD" or not self.current_state.armed:
                        self.get_logger().info("Mission interrupted during flight to waypoint.")
                        break

                    # ตรวจสอบ Timeout
                    elapsed = self.get_clock().now() - wp_start_time
                    if elapsed > rclpy.duration.Duration(seconds=WAYPOINT_TIMEOUT_SEC):
                        self.get_logger().warn(f"Waypoint {idx+1} timeout! Skipping to next waypoint.")
                        break

                    self.target_pose.header.stamp = self.get_clock().now().to_msg()
                    self.pose_pub.publish(self.target_pose)
                    
                    # ถ้าถึงเป้าหมายแล้ว ให้ออกจากลูป "go-to"
                    if self.is_at_target_position(tolerance=0.2):
                        self.get_logger().info(f"Reached Waypoint {idx+1}")
                        break
                    
                    rclpy.spin_once(self, timeout_sec=0.1)

                # Check exit condition after reaching waypoint (before hovering)
                if self.current_state.mode != "OFFBOARD" or not self.current_state.armed:
                    break
                    
                # ถ้าเป็นภารกิจหมุนตัว (Yaw) ให้รอนานหน่อย (5 วิ)
                # ถ้าเป็นภารกิจบิน ธรรมดา รอ 3 วิ
                hover_duration = 5.0 if yaw != 0.0 and idx == 7 else 3.0
                    
                self.get_logger().info(f"Hovering at Waypoint {idx+1}: ({x}, {y}, {z}, {yaw}) for {hover_duration} seconds...")
                hover_start_time = self.get_clock().now()
                while self.get_clock().now() - hover_start_time < rclpy.duration.Duration(seconds=hover_duration):
                    # Check exit condition during hover wait
                    if self.current_state.mode != "OFFBOARD" or not self.current_state.armed:
                        self.get_logger().info("Mission interrupted during waypoint hover.")
                        break

                    self.target_pose.header.stamp = self.get_clock().now().to_msg()
                    self.pose_pub.publish(self.target_pose) # ส่ง setpoint เดิมต่อเนื่อง
                    rclpy.spin_once(self, timeout_sec=0.1)
                        
            # --- ภารกิจเสร็จสิ้น (Mission Complete) -> Hover ---
            if self.current_state.mode == "OFFBOARD" and self.current_state.armed:
                self.get_logger().info("Waypoints Complete. Hovering at last position...")
                self.get_logger().info("Waiting for manual mode change (e.g. Land/Cancel) to end mission...")

            # Hover indefinitely until mode changes (e.g. user presses Land/Return or switched to Manual)
            while rclpy.ok():
                # Check exit condition: Mode changed from OFFBOARD or Disarmed
                # self.current_state.mode might be "AUTO.LAND" if Cancel is pressed
                if self.current_state.mode != "OFFBOARD" or not self.current_state.armed:
                    self.get_logger().info(f"Mission ended by external event. Current Mode: {self.current_state.mode}, Armed: {self.current_state.armed}")
                    break

                self.pose_pub.publish(self.target_pose)
                rclpy.spin_once(self, timeout_sec=0.1)

            # Ensure we wait for full disarm before resetting mission state loop
            # If user pressed Land, this loop waits for it to finish.
            while rclpy.ok() and self.current_state.armed:
                # If mode is not LAND, user might have just switched to POSCTL. We still wait for disarm to reset mission logic.
                if self.current_state.mode == "OFFBOARD":
                     # This case is weird if we exited the loop above, but just in case
                     pass
                rclpy.spin_once(self, timeout_sec=0.5)

            self.get_logger().info("Landed and disarmed. Mission Cycle Complete.")
            self.mission_started = False  # Reset for next mission loop
            # custom_waypoints ถูกเก็บไว้ใช้งานซ้ำได้จนกว่าจะมีชุดใหม่จาก Web UI
                
def main(args=None):
    rclpy.init(args=args)
    offboard_control_node = OffboardControl()
    try:
        offboard_control_node.run_mission()
    except KeyboardInterrupt:
        pass
    finally:
        # --- บันทึกข้อมูลการติดตามเป็นไฟล์ CSV ---
        # Removed to prevent crash on exit (numpy formatting issue on KeyboardInterrupt)
        # offboard_control_node.get_logger().info("Saving tracking data to CSV...")
        # ...
        
        offboard_control_node.destroy_node()
        rclpy.shutdown()
        
if __name__ == '__main__':
    main()