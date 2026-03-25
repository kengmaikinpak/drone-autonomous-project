import os
from ament_index_python.packages import get_package_share_directory
from launch import LaunchDescription
from launch.actions import DeclareLaunchArgument, IncludeLaunchDescription
from launch.launch_description_sources import AnyLaunchDescriptionSource
from launch.substitutions import LaunchConfiguration, PythonExpression
from launch_ros.actions import Node

def generate_launch_description():
    # Get MAVROS package path
    mavros_dir = get_package_share_directory('mavros')
    
    # Path to px4.launch (standard MAVROS launch file)
    px4_launch_path = os.path.join(mavros_dir, 'launch', 'px4.launch')

    # Declare dynamic IP arguments
    # กำหนด Argument สำหรับการเชื่อมต่อ (FCU URL)
    # ค่า Default ตั้งเป็น UDP สำหรับ SITL (localhost)
    # แต่ถ้าจะใช้ UART ให้เปลี่ยนเป็น /dev/ttyAMA0:921600 ตอนรันคำสั่ง
    fcu_url_arg = DeclareLaunchArgument(
        'fcu_url',
        default_value='udp://:14540@127.0.0.1:14557',
        description='Connection port (such as fcu_url:=/dev/ttyAMA0:921600 or fcu_url:=udp://:14540@[IP_ADDRESS]:14557)'
    )

    gcs_url_arg = DeclareLaunchArgument(
        'gcs_url',
        default_value='udp://@',
        description='URL for sending data to GCS (QGroundControl) (such as gcs_url:=udp://@[IP_ADDRESS]:14550)'
    )

    return LaunchDescription([
        fcu_url_arg,
        gcs_url_arg,

        # Include standard px4.launch from mavros
        IncludeLaunchDescription(
            AnyLaunchDescriptionSource(px4_launch_path),
            launch_arguments={
                'fcu_url': LaunchConfiguration('fcu_url'),
                'gcs_url': LaunchConfiguration('gcs_url'),
                'tgt_system': '1',
                'tgt_component': '1',
            }.items()
        ),

        # Run mission_control
        Node(
            package='my_drone_pkg',
            executable='mission_control',
            name='offboard_control_node',
            output='screen'
        ),

        # Run Rosbridge
        Node(
            package='rosbridge_server',
            executable='rosbridge_websocket',
            name='rosbridge_websocket',
            output='screen',
            parameters=[{
                'port': 9090,
                'address': '0.0.0.0',
            }]
        )
    ])
