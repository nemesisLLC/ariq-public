import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { createJourney } from '../app/entrance/journey.ts';

for (const mobile of [false, true]) {
  test(`entrance route keeps doorway visible and stays in clear aisle (${mobile ? 'mobile' : 'desktop'})`, () => {
    const path=createJourney(mobile),camera=new PerspectiveCamera(mobile?65:56,mobile?390/844:1920/1080,.06,75);
    let previous=path(0).eye;
    for(let i=0;i<=240;i++){
      const {eye,look,threshold}=path(i/240);
      assert.ok([...eye.toArray(),...look.toArray()].every(Number.isFinite));
      assert.ok(eye.z<=previous.z+.0001,'camera should progress toward the passage');
      assert.ok(eye.y>2 && eye.y<4,'camera remains at a plausible walking/gliding height');
      if(eye.z< -5.6)assert.ok(Math.abs(eye.x)+.4<2.05,'camera clearance inside doorway');
      if(eye.z> -6.3)assert.equal(threshold,0,'no fade before the doorway');
      if(eye.z> -3){
        camera.position.copy(eye);camera.lookAt(look);camera.updateMatrixWorld();
        const door=new Vector3(0,3.15,-6.1).project(camera);
        assert.ok(Math.abs(door.x)<.8 && Math.abs(door.y)<.85 && door.z<1,`door outside frame at ${i/240}`);
      }
      previous=eye;
    }
    assert.equal(path(1).threshold,1);
  });
}
