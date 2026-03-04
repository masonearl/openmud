#!/usr/bin/env python3
"""Create favicons with padding so logo doesn't get cut off."""
from PIL import Image

def make_favicon(size, logo_size_ratio=0.7):
    """Create favicon with logo scaled down and centered (padding around edges)."""
    logo = Image.open("assets/logo.png").convert("RGBA")
    logo_inner = int(size * logo_size_ratio)  # logo takes 70% of canvas
    logo_inner = max(logo_inner, 8)
    logo_resized = logo.resize((logo_inner, logo_inner), Image.Resampling.LANCZOS)
    
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = (size - logo_inner) // 2
    y = (size - logo_inner) // 2
    canvas.paste(logo_resized, (x, y), logo_resized)
    
    return canvas

fav32 = make_favicon(32, 0.65)
fav32.save("assets/favicon-32.png")

fav16 = make_favicon(16, 0.6)
fav16.save("assets/favicon-16.png")

print("Saved favicon-32.png and favicon-16.png with padding")
