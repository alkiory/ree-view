import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EnergyBalance } from '../src/energy-balance/schemas/energy-balance.schema';
import { EnergyBalanceService } from '../src/energy-balance/services/energy-balance.service';
import { ReeClientService } from '../src/energy-balance/services/ree-client.service';

describe('EnergyBalanceService', () => {
  let service: EnergyBalanceService;
  let balanceModel: Model<EnergyBalance>;
  let reeClient: ReeClientService;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        EnergyBalanceService,
        {
          provide: getModelToken(EnergyBalance.name),
          useValue: {
            // El servicio llama `exists(...)` antes de `find(...)`.
            // El mock original sólo tenía find/insertMany y dejaba
            // el test roto. Lo ampliamos para reflejar el contrato real.
            exists: jest.fn(),
            find: jest.fn(),
            insertMany: jest.fn(),
          },
        },
        {
          provide: ReeClientService,
          useValue: {
            fetchData: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<EnergyBalanceService>(EnergyBalanceService);
    balanceModel = module.get<Model<EnergyBalance>>(
      getModelToken(EnergyBalance.name),
    );
    reeClient = module.get<ReeClientService>(ReeClientService);
  });

  describe('getBalances', () => {
    it('should return existing data without fetching', async () => {
      const mockData = [
        {
          datetime: new Date('2025-04-20'),
          type: 'Hidráulica',
          value: 1000,
          percentage: 0.2,
        },
      ];

      // exists() devuelve un doc → el servicio NO llama a REE
      jest
        .spyOn(balanceModel, 'exists')
        .mockResolvedValue({ _id: 'cached' } as any);
      jest.spyOn(balanceModel, 'find').mockReturnValue({
        exec: jest.fn().mockResolvedValue(mockData),
      } as any);

      const result = await service.getBalances({
        startDate: '2025-04-20',
        endDate: '2025-04-20',
      });

      expect(result).toEqual(mockData);
      expect(reeClient.fetchData).not.toHaveBeenCalled();
    });

    it('should fetch and save missing data', async () => {
      // exists() devuelve null → el servicio SÍ llama a REE
      jest.spyOn(balanceModel, 'exists').mockResolvedValue(null as any);
      jest.spyOn(balanceModel, 'find').mockReturnValue({
        exec: jest.fn().mockResolvedValue([]),
      } as any);

      const mockApiData = [
        {
          datetime: new Date('2025-04-20'),
          type: 'Eólica',
          value: 2000,
          percentage: 0.3,
        },
      ];

      jest.spyOn(reeClient, 'fetchData').mockResolvedValue(mockApiData);
      jest
        .spyOn(balanceModel, 'insertMany')
        .mockResolvedValue(mockApiData as any);

      await service.getBalances({
        startDate: '2025-04-20',
        endDate: '2025-04-20',
      });

      expect(reeClient.fetchData).toHaveBeenCalled();
      expect(balanceModel.insertMany).toHaveBeenCalledWith(mockApiData);
    });
  });
});
