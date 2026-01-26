import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument
from launch.substitutions import LaunchConfiguration
from launch_ros.actions import Node

def generate_launch_description():
    # 1. กำหนดตำแหน่งไฟล์ YAML ของ MAVROS (มาตรฐานใน Humble)
    # กำหนดตำแหน่งไฟล์ YAML ของ MAVROS จากโฟลเดอร์ config ใหม่ใน package ของเรา (แก้ plugin เรียก topic ชนกัน)
    # ปกติจะอยู่ที่ /opt/ros/humble/share/mavros/launch/
    my_drone_pkg_dir = get_package_share_directory('my_drone_pkg')
    config_yaml = os.path.join(my_drone_pkg_dir, 'config', 'px4_config.yaml')
    plugin_yaml = os.path.join(my_drone_pkg_dir, 'config', 'px4_pluginlists.yaml')

    return LaunchDescription([
        # 2. ตั้งค่า FCU URL สำหรับต่อกับ Gazebo/PX4
        DeclareLaunchArgument(
            'fcu_url',
            default_value='udp://:14540@localhost:14557',
            description='URL for connecting to PX4'
        ),

        # 3. รัน MAVROS Node โดยตรง (ใช้ไฟล์ YAML เป็นพารามิเตอร์)
        Node(
            package='mavros',
            executable='mavros_node',
            name='mavros',
            parameters=[
                config_yaml,
                plugin_yaml,
                {'fcu_url': LaunchConfiguration('fcu_url')}
            ],
            output='screen'
        ),

        # 4. รัน Node (takeoff_node.py)
        Node(
            package='my_drone_pkg',
            executable='takeoff_node',
            name='offboard_control_node',
            output='screen'
        )
    ])