import { CatmullRomCurve3, MathUtils, Vector3 } from 'three';

export const JOURNEY_SECONDS = 5.8;
export function createJourney(mobile = false) {
  const position = new CatmullRomCurve3([
    new Vector3(0, 3.2, mobile ? 15.8 : 11.8),
    new Vector3(.15, 3.55, 9.4),
    new Vector3(.1, 3.05, 3.4),
    new Vector3(0, 2.6, -3.0),
    new Vector3(0, 2.5, -9.1),
  ], false, 'centripetal');
  const target = new CatmullRomCurve3([
    new Vector3(0, 6.5, -4.5),
    new Vector3(0, 7.0, -5.8),
    new Vector3(0, 4.0, -10.0),
    new Vector3(0, 2.9, -17),
    new Vector3(0, 2.7, -24),
  ], false, 'centripetal');
  return (progress: number) => {
    const t = MathUtils.clamp(progress, 0, 1);
    const eye = position.getPoint(t), look = target.getPoint(t);
    // The fade starts only after the lens crosses the rear doorway at z=-6.1.
    return { eye, look, threshold: MathUtils.smoothstep(-eye.z, 6.3, 9.05) };
  };
}
