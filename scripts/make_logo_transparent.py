#!/usr/bin/env python3
"""Convert logo to white on transparent background."""
from PIL import Image

img = Image.open("assets/logo.png").convert("RGBA")
data = img.getdata()

new_data = []
for item in data:
    r, g, b, a = item
    brightness = (r + g + b) / 3
    # Dark pixels -> transparent
    if brightness < 80:
        new_data.append((255, 255, 255, 0))
    else:
        # Light pixels -> white, preserve anti-aliasing via alpha
        alpha = int(255 * (brightness / 255))
        new_data.append((255, 255, 255, min(alpha, a)))

img.putdata(new_data)
img.save("assets/logo-transparent.png")
print("Saved assets/logo-transparent.png")
