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
npm test         # Run cloth, geometry and rendering math tests
```

## Using the viewer

Click **Upload Image (Auto-Size)** to load a PNG, JPEG, WebP or SVG. The viewer
keeps the image's aspect ratio and sizes the flag to fit the pole.

| Panel | Settings |
| --- | --- |
| Flag Settings | Image, satin or anime shading, fabric sheen |
| Shape | Cone or flat preset, cone amount, size and rotation |
| Physics | Bending stiffness, shape retention and damping |
| Advanced Drape | Opening, shoulder, fold count and depth, twist |
| Bend Profile | Local bends near the pole, in the middle and at the free edge |
| Fringe Settings | Visibility, length and density |
| Flagpole | Pole length |
| Motion | Animation, wind response, speed and direction |
| View | Orthographic or perspective projection |

**Cone** and **Flat** use the same upper attachment. **Cone Amount** blends
between them: 0 is flat, 1 is conical. Intermediate values show **Custom**.
Changing the preset keeps the image, flag size and pole settings.

Higher **Bending** values make the cloth stiffer. **Shape Hold** controls how
closely it follows the selected drape. **Damping** reduces motion as the cloth
settles. The controls in **Advanced Drape** and **Bend Profile** shape the drape
that the cloth settles toward.
Fold and bend controls take effect as **Cone Amount** increases; at 0 the rest
shape is a flat plane. Turning off **Animate** pauses both gravity and wind.

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

A coarse cloth mesh runs a custom XPBD solver under gravity and wind. Distance,
shear and bending constraints limit stretching and control flexibility. Shape
constraints pull the cloth toward the selected flat or conical drape. The
renderer uses a denser surface for the cloth and fringe.

Folds can hide parts of the image or make them appear narrower from some angles.
The solver handles contact with the pole. Collisions between folds are not
calculated, so extreme settings can make the cloth intersect itself.

## Source

- [src/engine/](src/engine/) — WebGL renderer, camera, geometry and vector math.
- [src/drape/](src/drape/) — fold curves and flag surface generation.
- [src/physics/](src/physics/) — cloth constraints, gravity, wind and pole contact.
- [src/rendering/](src/rendering/) — materials, stand and fringe.
- [src/ui/](src/ui/) — viewer controls and image loading.
- [tests/](tests/) — cloth constraints, material lengths, pole clearance, fringe, projection and resource disposal tests.
