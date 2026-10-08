# Standard Engine

A browser viewer for ceremonial flags on floor stands. Upload a flag image,
adjust the folds and fringe, and view it from different angles.

The renderer is written in TypeScript and GLSL using WebGL 2.

## Local development

Use Node.js 22.12 or newer and a browser with WebGL 2 support.

```sh
npm ci
npm run dev
```

Open [localhost:5173/StandardEngine/](http://localhost:5173/StandardEngine/).
Vite prints the address in the terminal if it uses a different port.

```sh
npm run build    # Build to dist/
npm run preview  # Serve the production build locally
npm test         # Run the geometry and rendering math tests
```

## Using the viewer

Click **Upload Image (Auto-Size)** to load a PNG, JPEG, WebP or SVG. The viewer
keeps the image's aspect ratio and sizes the flag to fit the pole.

| Panel | Settings |
| --- | --- |
| Flag Settings | Image, satin or anime shading, fabric sheen |
| Drape Shape | Size, opening, shoulder, fold count and depth, twist and rotation |
| Bend Profile | Local bends near the pole, in the middle and at the free edge |
| Fringe Settings | Visibility, length and density |
| Flagpole | Pole length |
| Motion | Animation, softness, wind speed and direction |
| View | Orthographic or perspective projection |

In **Bend Profile**, change the sign of an angle to reverse the fold. If a shape
would pass through the pole, the viewer reduces the bend strength.
**Applied Bend %** shows how much of the requested strength is used; 100 means
the bends are unrestricted.

**Reset Shape** restores the default drape and keeps the current image, material
and fringe settings. **Reset View** returns the camera to its initial position.

### Camera controls

| Action | Input |
| --- | --- |
| Orbit | Drag |
| Pan | Shift-drag or right-drag |
| Zoom | Scroll or pinch |

## Drape model

The cloth is generated from a curvature profile. Its surface preserves material
lengths as it bends, so changing the shape does not rescale the printed image.
Folds can hide parts of the image or make them appear narrower from some angles.

Wind changes the fold profile over time. This is a procedural drape, not a full
cloth simulation: collisions between folds are not calculated, and extreme
settings can make the cloth intersect itself.

## Source

- [src/engine/](src/engine/) — WebGL renderer, camera, geometry and vector math.
- [src/drape/](src/drape/) — fold curves and flag surface generation.
- [src/rendering/](src/rendering/) — materials, stand and fringe.
- [src/ui/](src/ui/) — viewer controls and image loading.
- [tests/](tests/) — material lengths, pole clearance, fringe, projection and resource disposal tests.
