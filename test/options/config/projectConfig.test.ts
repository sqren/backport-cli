import findUp from 'find-up';
import * as rpc from '../../../src/services/rpc';
import { PromiseReturnType } from '../../../src/types/commons';
import { getProjectConfig } from '../../../src/options/config/projectConfig';

describe('getProjectConfig', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('when projectConfig is valid', () => {
    let projectConfig: PromiseReturnType<typeof getProjectConfig>;
    beforeEach(async () => {
      jest
        .spyOn(rpc, 'readFile')
        .mockResolvedValue(
          JSON.stringify({ upstream: 'elastic/kibana', branches: ['6.x'] })
        );

      projectConfig = await getProjectConfig();
    });

    it('should call findUp', () => {
      expect(findUp).toHaveBeenCalledWith('.backportrc.json');
    });

    it('should return config with branches', () => {
      expect(projectConfig).toEqual({
        branches: ['6.x'],
        upstream: 'elastic/kibana'
      });
    });
  });

  describe('when projectConfig is empty', () => {
    it('should return empty config', async () => {
      jest.spyOn(rpc, 'readFile').mockResolvedValueOnce('{}');
      const projectConfig = await getProjectConfig();
      expect(projectConfig).toEqual({ branchChoices: undefined });
    });
  });

  describe('when projectConfig is missing', () => {
    it('should return empty config', async () => {
      (findUp as any).__setMockPath();
      const projectConfig = await getProjectConfig();
      expect(projectConfig).toEqual({});
    });
  });
});
