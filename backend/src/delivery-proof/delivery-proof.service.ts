import { BadRequestException, Injectable, NotFoundException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PaginatedResponse, PaginationUtil } from '../common/pagination';
import { CreateDeliveryProofDto } from './dto/create-delivery-proof.dto';
import { DeliveryProofQueryDto } from './dto/delivery-proof-query.dto';
import { DeliveryProofEntity } from './entities/delivery-proof.entity';

import { ConfigService } from '@nestjs/config';
import { SorobanService } from '../soroban/soroban.service';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// Blood products must be stored between 2°C and 6°C (backend compliance threshold)
const TEMP_MIN_CELSIUS = 2;
const TEMP_MAX_CELSIUS = 6;

export interface DeliveryStatistics {
  totalDeliveries: number;
  successfulDeliveries: number;
  successRate: number;
  temperatureCompliantDeliveries: number;
  temperatureComplianceRate: number;
  averageTemperatureCelsius: number | null;
}

@Injectable()
export class DeliveryProofService {
  private readonly logger = new Logger(DeliveryProofService.name);

  constructor(
    @InjectRepository(DeliveryProofEntity)
    private readonly proofRepo: Repository<DeliveryProofEntity>,
    private readonly configService: ConfigService,
    private readonly sorobanService: SorobanService,
  ) {}

  /**
   * Handles delivery proof photo upload:
   * 1. Compute SHA-256 of raw bytes.
   * 2. Save to local storage (mock object storage).
   * 3. Anchor hash on Soroban.
   * 4. Update DeliveryProofEntity.
   * Closes #464
   */
  async uploadPhoto(orderId: string, file: any) {
    if (!file) {
       throw new BadRequestException('No file uploaded');
    }

    // Max 5MB check (handled by Multer mostly but good to have)
    if (file.size > 5 * 1024 * 1024) {
       throw new BadRequestException('Payload Too Large (Max 5MB)');
    }

    // 1. Compute SHA-256
    const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // 2. Save to storage
    const storagePath = this.configService.get<string>('STORAGE_PATH', './uploads');
    if (!fs.existsSync(storagePath)) {
       fs.mkdirSync(storagePath, { recursive: true });
    }
    const fileName = `${orderId}-${Date.now()}-${file.originalname}`;
    const filePath = path.join(storagePath, fileName);
    fs.writeFileSync(filePath, file.buffer);
    const storageUrl = `/uploads/${fileName}`;

    // 3. Find or create entity
    let proof = await this.proofRepo.findOne({ where: { orderId } });
    if (!proof) {
       // Create minimal proof if not exists
       proof = this.proofRepo.create({
         orderId,
         riderId: 'PENDING', // Will be updated
         pickupTimestamp: new Date(),
         deliveredAt: new Date(),
         recipientName: 'PENDING',
         temperatureReadings: [4.0], // Default compliant temp
       });
    }

    proof.photoUrl = storageUrl;
    if (!proof.photoHashes) proof.photoHashes = [];
    proof.photoHashes.push(hash);

    // 4. Anchor on Soroban
    try {
       const anchorResult = await this.sorobanService.anchorHash(orderId, hash);
       proof.blockchainTxHash = anchorResult.transactionHash;
    } catch (error) {
       this.logger.error(`Failed to anchor hash for order ${orderId}: ${error.message}`);
       // We still save the file and hash locally
    }

    await this.proofRepo.save(proof);

    return {
       success: true,
       hash,
       storageUrl,
       transactionId: proof.blockchainTxHash,
    };
  }


  async create(dto: CreateDeliveryProofDto): Promise<DeliveryProofEntity> {
    const pickupTimestamp = new Date(dto.pickupTimestamp);
    const deliveredAt = new Date(dto.deliveredAt);

    if (deliveredAt < pickupTimestamp) {
      throw new BadRequestException(
        'deliveredAt must be after pickupTimestamp',
      );
    }
    if (!dto.temperatureReadings || dto.temperatureReadings.length === 0) {
      throw new BadRequestException(
        'At least one temperature reading is required',
      );
    }

    const isTemperatureCompliant = dto.temperatureReadings.every(
      (t) => t >= TEMP_MIN_CELSIUS && t <= TEMP_MAX_CELSIUS,
    );

    const proof = this.proofRepo.create({
      orderId: dto.orderId,
      requestId: dto.requestId ?? null,
      riderId: dto.riderId,
      pickupTimestamp,
      pickupLocationHash: dto.pickupLocationHash ?? null,
      deliveredAt,
      deliveryLocationHash: dto.deliveryLocationHash ?? null,
      recipientName: dto.recipientName,
      recipientSignatureUrl: dto.recipientSignatureUrl ?? null,
      recipientSignatureHash: dto.recipientSignatureHash ?? null,
      photoUrl: dto.photoUrl ?? null,
      photoHashes: dto.photoHashes ?? [],
      temperatureReadings: dto.temperatureReadings,
      temperatureCelsius: dto.temperatureCelsius ?? null,
      notes: dto.notes ?? null,
      isTemperatureCompliant,
      verified: false,
    });

    return this.proofRepo.save(proof);
  }

  async getDeliveryProof(id: string): Promise<DeliveryProofEntity> {
    const proof = await this.proofRepo.findOne({ where: { id } });
    if (!proof) throw new NotFoundException(`Delivery proof '${id}' not found`);
    return proof;
  }

  async getProofsByRider(
    riderId: string,
    query: DeliveryProofQueryDto,
  ): Promise<PaginatedResponse<DeliveryProofEntity>> {
    return this.queryProofs({ ...query, riderId });
  }

  async getProofsByRequest(
    requestId: string,
    query: DeliveryProofQueryDto,
  ): Promise<PaginatedResponse<DeliveryProofEntity>> {
    return this.queryProofs({ ...query, requestId });
  }

  async queryProofs(
    query: DeliveryProofQueryDto,
  ): Promise<PaginatedResponse<DeliveryProofEntity>> {
    const { page = 1, pageSize = 25 } = query;
    const qb = this.proofRepo.createQueryBuilder('proof');

    if (query.riderId) {
      qb.andWhere('proof.riderId = :riderId', { riderId: query.riderId });
    }
    if (query.requestId) {
      qb.andWhere('proof.requestId = :requestId', { requestId: query.requestId });
    }
    if (query.startDate) {
      qb.andWhere('proof.deliveredAt >= :startDate', { startDate: query.startDate });
    }
    if (query.endDate) {
      qb.andWhere('proof.deliveredAt <= :endDate', { endDate: query.endDate });
    }
    if (query.temperatureCompliantOnly) {
      qb.andWhere('proof.isTemperatureCompliant = true');
    }

    qb.orderBy('proof.deliveredAt', 'DESC');
    qb.skip(PaginationUtil.calculateSkip(page, pageSize));
    qb.take(pageSize);

    const [data, total] = await qb.getManyAndCount();
    return PaginationUtil.createResponse(data, page, pageSize, total);
  }

  isTemperatureCompliant(temperatureCelsius: number): boolean {
    return (
      temperatureCelsius >= TEMP_MIN_CELSIUS &&
      temperatureCelsius <= TEMP_MAX_CELSIUS
    );
  }

  async getDeliveryStatistics(
    riderId?: string,
    startDate?: string,
    endDate?: string,
  ): Promise<DeliveryStatistics> {
    const qb = this.proofRepo.createQueryBuilder('proof');

    if (riderId) qb.andWhere('proof.riderId = :riderId', { riderId });
    if (startDate) qb.andWhere('proof.deliveredAt >= :startDate', { startDate });
    if (endDate) qb.andWhere('proof.deliveredAt <= :endDate', { endDate });

    const proofs = await qb.getMany();

    const totalDeliveries = proofs.length;
    const successfulDeliveries = proofs.length;
    const successRate = this.calculateSuccessRate(successfulDeliveries, totalDeliveries);

    const compliant = proofs.filter((p) => p.isTemperatureCompliant);
    const temperatureComplianceRate = this.calculateSuccessRate(
      compliant.length,
      totalDeliveries,
    );

    const withTemp = proofs.filter((p) => p.temperatureCelsius !== null);
    const averageTemperatureCelsius =
      withTemp.length > 0
        ? withTemp.reduce((sum, p) => sum + p.temperatureCelsius!, 0) / withTemp.length
        : null;

    return {
      totalDeliveries,
      successfulDeliveries,
      successRate,
      temperatureCompliantDeliveries: compliant.length,
      temperatureComplianceRate,
      averageTemperatureCelsius:
        averageTemperatureCelsius !== null
          ? Math.round(averageTemperatureCelsius * 100) / 100
          : null,
    };
  }

  calculateSuccessRate(successful: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((successful / total) * 10000) / 100;
  }
}
