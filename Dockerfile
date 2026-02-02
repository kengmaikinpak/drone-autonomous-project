FROM osrf/ros:jazzy-desktop

# ติดตั้ง MAVROS และ Dependencies
RUN apt-get update && apt-get install -y \
    ros-jazzy-mavros ros-jazzy-mavros-extras \
    ros-jazzy-rosbridge-suite \
    python3-pip wget && rm -rf /var/lib/apt/lists/*

# ติดตั้งข้อมูลแผนที่สำหรับ MAVROS
RUN wget https://raw.githubusercontent.com/mavlink/mavros/master/mavros/scripts/install_geographiclib_datasets.sh \
    && bash ./install_geographiclib_datasets.sh && rm install_geographiclib_datasets.sh

WORKDIR /ros2_ws
RUN echo "source /opt/ros/jazzy/setup.bash" >> ~/.bashrc
