from setuptools import find_packages, setup
import os
from glob import glob

package_name = 'my_drone_pkg'

setup(
    name=package_name,
    version='0.0.0',
    packages=find_packages(exclude=['test']),
    data_files=[
        ('share/ament_index/resource_index/packages',
            ['resource/' + package_name]),
        ('share/' + package_name, ['package.xml']),
        (os.path.join('share', package_name, 'launch'), glob('launch/*.launch.py')),
        (os.path.join('share', package_name, 'config'), glob('config/*')),
    ],
    install_requires=['setuptools'],
    zip_safe=True,
    maintainer='kengmaikinpak',
    maintainer_email='Apisit5835@gmail.com',
    description='Autonomous drone control package using ROS 2 and MAVROS',
    license='Apache License 2.0',
    extras_require={
        'test': [
            'pytest',
        ],
    },
    entry_points={
        'console_scripts': [
            "mission_control = my_drone_pkg.mission_control:main",
        ],
    },
)
