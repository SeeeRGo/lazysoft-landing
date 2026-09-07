import {expect,it} from 'vitest';
import {sandboxConfigArgs,nestedContainerArgs} from '../automation/isolation.mjs';
it('uses a named inner profile with denied credential reads and no tool network',()=>{
  expect(sandboxConfigArgs.join(' ')).toContain('"/home/node/.codex"="deny"');
  expect(sandboxConfigArgs.join(' ')).toContain('network.enabled=false');
  expect(sandboxConfigArgs.join(' ')).not.toContain('danger-full-access');
  expect(nestedContainerArgs).toHaveLength(2);
});
