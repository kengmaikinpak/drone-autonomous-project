import rclpy
import math
from rclpy.node import Node
from rclpy.clock import Clock
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy
from mavros_msgs.msg import State # สถานะของโดรน
from mavros_msgs.srv import CommandBool, SetMode # บริการสั่ง arm และ Set Mode
from geometry_msgs.msg import PoseStamped # ข้อมูลตำแหน่ง

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
        
        # สร้าง List สำหรับเก็บข้อมูลพล็อต
        self.log_time = []
        self.log_target_x = []
        self.log_actual_x = []
        self.log_target_y = []
        self.log_actual_y = []
        self.log_target_z = []
        self.log_actual_z = []
        
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

    # ---------------------------------------
    # ฟังก์ชันหลักในการรันภารกิจ
    # ---------------------------------------
    
    def run_mission(self):
        while not self.current_state.connected:
            rclpy.spin_once(self)
            self.get_logger().info("Waiting for connection to MAVROS...")
        self.get_logger().info("MAVROS connected!")

        # ส่ง setpoints ก่อนเปลี่ยนโหมด (อย่างน้อย 100 ครั้ง)(ให้ผ่านเช็ค QoS)
        # ตั้งค่า target_pose เริ่มต้นที่ (0,0,0)
        self.target_pose = PoseStamped()
        self.target_pose.header.frame_id = "map"
        self.target_pose.pose.position.x = 0.0
        self.target_pose.pose.position.y = 0.0
        self.target_pose.pose.position.z = 0.0 
        
        for _ in range(100):
            self.target_pose.header.stamp = self.get_clock().now().to_msg()
            self.pose_pub.publish(self.target_pose)
            rclpy.spin_once(self, timeout_sec=0.05)
            self.get_logger().info("Sending initial setpoints...")
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
        
        # --- ลูปภารกิจหลัก (Main Mission Loop) ---
        for idx, (x, y, z, yaw) in enumerate(waypoints):
            self.target_pose.pose.position.x = x
            self.target_pose.pose.position.y = y
            self.target_pose.pose.position.z = z
            self.set_orientation_from_yaw(yaw)
            
            self.get_logger().info(f"Heading to Waypoint {idx+1}: ({x}, {y}, {z}, {yaw} degrees)")
            
            # ลูป "ไปที่เป้าหมาย" (Go-to Loop)
            while rclpy.ok():
                self.target_pose.header.stamp = self.get_clock().now().to_msg()
                self.pose_pub.publish(self.target_pose)
                rclpy.spin_once(self, timeout_sec=0.1)
                
                
                # --- บันทึกข้อมูลลง List ---
                self.log_time.append(self.get_clock().now().nanoseconds)
                self.log_target_x.append(self.target_pose.pose.position.x)
                self.log_actual_x.append(self.current_pose.pose.position.x)
                self.log_target_y.append(self.target_pose.pose.position.y)
                self.log_actual_y.append(self.current_pose.pose.position.y)
                self.log_target_z.append(self.target_pose.pose.position.z)
                self.log_actual_z.append(self.current_pose.pose.position.z)
                # ------------------------------
                
                
                # ถ้าถึงเป้าหมายแล้ว ให้ออกจากลูป "go-to"
                if self.is_at_target_position(tolerance=0.2):
                    self.get_logger().info(f"Reached Waypoint {idx+1}")
                    break
                
            # ถ้าเป็นภารกิจหมุนตัว (Yaw) ให้รอนานหน่อย (5 วิ)
            # ถ้าเป็นภารกิจบิน ธรรมดา รอ 3 วิ
            hover_duration = 5.0 if yaw != 0.0 and idx == 7 else 3.0
                
            self.get_logger().info(f"Hovering at Waypoint {idx+1}: ({x}, {y}, {z}, {yaw}) for {hover_duration} seconds...")
            hover_start_time = self.get_clock().now()
            while self.get_clock().now() - hover_start_time < rclpy.duration.Duration(seconds=hover_duration):
                self.target_pose.header.stamp = self.get_clock().now().to_msg()
                self.pose_pub.publish(self.target_pose) # ส่ง setpoint เดิมต่อเนื่อง
                rclpy.spin_once(self, timeout_sec=0.1)
                
                
                # --- บันทึกข้อมูลลง List ---
                self.log_time.append(self.get_clock().now().nanoseconds)
                self.log_target_x.append(self.target_pose.pose.position.x)
                self.log_actual_x.append(self.current_pose.pose.position.x)
                self.log_target_y.append(self.target_pose.pose.position.y)
                self.log_actual_y.append(self.current_pose.pose.position.y)
                self.log_target_z.append(self.target_pose.pose.position.z)
                self.log_actual_z.append(self.current_pose.pose.position.z)
                # ------------------------------    
                    
        # สั่ง Land (เปลี่ยนโหมดเป็น LAND)
        self.get_logger().info("Mission completed. Landing...")
        land_mode_req = SetMode.Request()
        land_mode_req.custom_mode = "AUTO.LAND"
        self.set_mode_client.call_async(land_mode_req)
        
        # รอจนกว่าโดรนจะลงจอดและ disarm
        while self.current_state.armed:
            rclpy.spin_once(self, timeout_sec=0.1)
        self.get_logger().info("Landed and disarmed. Mission Complete.")
                
def main(args=None):
    rclpy.init(args=args)
    offboard_control_node = OffboardControl()
    try:
        offboard_control_node.run_mission()
    except KeyboardInterrupt:
        pass
    finally:
        # --- บันทึกข้อมูลการติดตามเป็นไฟล์ CSV ---
        offboard_control_node.get_logger().info("Saving tracking data to CSV...")
        
        # 1. รวบรวมข้อมูลทั้งหมดเป็น Array
        data_to_save = np.column_stack([
            offboard_control_node.log_time,
            offboard_control_node.log_target_x,
            offboard_control_node.log_actual_x,
            offboard_control_node.log_target_y,
            offboard_control_node.log_actual_y,
            offboard_control_node.log_target_z,
            offboard_control_node.log_actual_z
        ])
        
        # 2. บันทึกเป็นไฟล์ CSV (ชื่อ mission_data.csv)
        header = "Time,Target_X,Actual_X,Target_Y,Actual_Y,Target_Z,Actual_Z"
        np.savetxt("mission_data.csv", data_to_save, delimiter=",", header=header, fmt="%f")
        
        offboard_control_node.get_logger().info("Data saved to mission_data.csv.")
        # ---------------------------------------------
        
        offboard_control_node.destroy_node()
        rclpy.shutdown()
        
if __name__ == '__main__':
    main()