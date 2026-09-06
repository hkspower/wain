# The rig at 4K

Six 3840x2160 frames of the zeta-300-gtr, rendered by tools/shots/ik4k.mjs through the game's own 4K pin at the ultra tier. 
Every number is read off the engine at the frame of the exposure — the picture is evidence, the caption is the measurement.

| frame | what the rig is doing | measured |
|---|---|---|
| [lock](lock.jpg) | full lock at 15 km/h, front quarter | fronts -0.52 / -0.389 rad; roll 0°, pitch 0°; hubs off road 0.0/0.0/0.0/0.0 mm; wing 0 rad; 14 km/h, -0.01 m/s² lateral, buffer 3840x2160 |
| [sweep](sweep.jpg) | Ras Al-Ard at 120 km/h, wheel straight | fronts 0 / 0 rad; roll -1.02°, pitch 1.1°; hubs off road 0.0/0.0/0.0/0.0 mm; wing -0.022 rad; rival storm-s8 roll -1.79°, hubs 0.0/0.0/0.0/0.0 mm, fronts 0 / 0, wing -0.022; 119 km/h, 5.64 m/s² lateral, buffer 3840x2160 |
| [brake](brake.jpg) | braking from 200 km/h, rear quarter | fronts 0 / 0 rad; roll 0.38°, pitch 2.61°; hubs off road 0.0/0.0/0.0/0.0 mm; wing 0.462 rad; 155 km/h, -1.46 m/s² lateral, buffer 3840x2160 |
| [drift](drift.jpg) | drift, 23 frames in | fronts -0.518 / -0.388 rad; roll -0.77°, pitch -0.3°; yaw 32.1°; hubs off road 0.0/0.0/0.0/0.0 mm; wing 0.407 rad; 243 km/h, 5.87 m/s² lateral, buffer 3840x2160 |
| [traffic](traffic.jpg) | a civilian through Ras Al-Ard at 120 km/h | fronts 0 / 0 rad; roll -1.07°, pitch 1.1°; yaw 0.7°; hubs off road 0.0/0.0/0.0/0.0 mm; wing -0.022 rad; civilian roll -2.5°, hubs 0.0/0.0/0.0/0.0 mm, fronts 0.169 / 0.188; 119 km/h, 5.91 m/s² lateral, buffer 3840x2160 |
| [driver](driver.jpg) | driver at 85% lock, through the side glass | fronts -0.442 / -0.342 rad; roll 0.07°, pitch 0°; hubs off road 0.0/0.0/0.0/0.0 mm; wing -0.001 rad; hand wheel -2.04 rad; 22 km/h, -0.15 m/s² lateral, buffer 3840x2160 |

The .png files are the lossless frames (kept out of git); the .jpg copies are what the repository tracks, and each frame's .json is the state it was read from.
