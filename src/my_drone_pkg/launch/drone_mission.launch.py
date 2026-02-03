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

    return LaunchDescription([
        # Declare dynamic IP arguments
        DeclareLaunchArgument(
            'drone_ip',
            default_value='127.0.0.1',
            description='IP address of the drone (PC A)'
        ),
        DeclareLaunchArgument(
            'gcs_ip',
            default_value='127.0.0.1',
            description='IP address for QGroundControl (PC B)'
        ),

        # Include standard px4.launch from mavros
        IncludeLaunchDescription(
            AnyLaunchDescriptionSource(px4_launch_path),
            launch_arguments={
                'fcu_url': PythonExpression(["'udp://:14540@' + '", LaunchConfiguration('drone_ip'), "' + ':14557'"]),
                'gcs_url': PythonExpression(["'udp://@' + '", LaunchConfiguration('gcs_ip'), "' + ':14550'"])
            }.items()
        ),

        # Run takeoff_node
        Node(
            package='my_drone_pkg',
            executable='takeoff_node',
            name='offboard_control_node',
            output='screen'
        ),

        # Run Rosbridge
        Node(
            package='rosbridge_server',
            executable='rosbridge_websocket',
            name='rosbridge_websocket',
            output='screen',
            parameters=[{'port': 9090}]
        )
    ])