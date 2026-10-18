import {describe,expect,it} from 'vitest';
import {demoEmailEdited} from '../lib/demo-input';
const preset={from:'source@example.com',subject:'Synthetic subject',body:'Synthetic body'};
describe('demo email edits',()=>{
  it('submits subject-only changes',()=>{expect(demoEmailEdited({...preset,subject:'Changed subject'},preset)).toBe(true);});
  it('submits body and sender changes',()=>{expect(demoEmailEdited({...preset,body:'Changed body'},preset)).toBe(true);expect(demoEmailEdited({...preset,from:'other@example.com'},preset)).toBe(true);});
  it('keeps untouched presets recognizable',()=>{expect(demoEmailEdited(null,preset)).toBe(false);expect(demoEmailEdited({...preset},preset)).toBe(false);});
});
