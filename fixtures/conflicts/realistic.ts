import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
<<<<<<< HEAD
import { OAuthProvider } from './oauth/provider';
import { TokenStore } from './oauth/token-store';
import { RateLimiter } from './security/rate-limiter';
=======
import { MetricsCollector } from './metrics';
import { AuditLogger } from './audit';
>>>>>>> origin/main
import { User } from './user.entity';
import { CreateUserInput } from './dto/create-user.input';

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
<<<<<<< HEAD
    private readonly oauth: OAuthProvider,
    private readonly tokens: TokenStore,
    private readonly limiter: RateLimiter,
=======
    private readonly metrics: MetricsCollector,
    private readonly audit: AuditLogger,
>>>>>>> origin/main
  ) {}

  async findById(id: string): Promise<User | null> {
<<<<<<< HEAD
    await this.limiter.consume(`findById:${id}`, 1);
    const user = await this.repo.findOne({
      where: { id },
      relations: ['profile', 'roles', 'tokens'],
    });
    if (!user) return null;
    await this.tokens.touch(user.id);
    return user;
=======
    const start = Date.now();
    const user = await this.repo.findOne({ where: { id }, cache: 5000 });
    this.metrics.recordLookup('user.findById', Date.now() - start, !!user);
    return user;
>>>>>>> origin/main
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  async create(input: CreateUserInput): Promise<User> {
    if (!input.email?.match(/^[^@\s]+@[^@\s]+\.[^@\s]+$/)) {
      throw new Error('invalid email format');
    }
<<<<<<< HEAD
    const existing = await this.findByEmail(input.email);
    if (existing) throw new Error('email already taken');
    const user = this.repo.create({
      ...input,
      email: input.email.toLowerCase(),
      createdAt: new Date(),
    });
    const saved = await this.repo.save(user);
    await this.tokens.issue(saved.id);
    this.logger.log(`user created: ${saved.id}`);
    return saved;
=======
    const user = this.repo.create(input);
    const saved = await this.repo.save(user);
    await this.audit.record('user.created', { id: saved.id, email: saved.email });
    this.metrics.recordSignup(saved.id);
    return saved;
>>>>>>> origin/main
  }

<<<<<<< HEAD
  async loginWithOAuth(code: string, provider: string): Promise<{ user: User; token: string }> {
    await this.limiter.consume(`login:${provider}`, 5);
    const profile = await this.oauth.exchange(code, provider);
    let user = await this.findByEmail(profile.email);
    if (!user) {
      user = await this.create({
        email: profile.email,
        name: profile.name,
        avatarUrl: profile.picture,
      });
    }
    const token = await this.tokens.issue(user.id);
    return { user, token };
  }

  async rotateAllTokens(): Promise<number> {
    const active = await this.repo.find({ where: { active: true } });
    let rotated = 0;
    for (const user of active) {
      try {
        await this.tokens.rotate(user.id);
        rotated++;
      } catch (e) {
        this.logger.warn(`failed to rotate token for ${user.id}: ${e}`);
      }
    }
    return rotated;
  }

=======
>>>>>>> origin/main
  async listAll(filter?: { email?: string; role?: string }): Promise<User[]> {
    const query = this.repo.createQueryBuilder('user');
    if (filter?.email) query.andWhere('user.email LIKE :e', { e: `%${filter.email}%` });
    if (filter?.role)  query.andWhere('user.role = :r',     { r: filter.role });
<<<<<<< HEAD
    return query
      .orderBy('user.createdAt', 'DESC')
      .take(100)
      .getMany();
=======
    return query.orderBy('user.id', 'ASC').take(50).getMany();
>>>>>>> origin/main
  }

  async countByRole(): Promise<Record<string, number>> {
    const rows = await this.repo
      .createQueryBuilder('u')
      .select('u.role', 'role')
      .addSelect('COUNT(*)', 'count')
      .groupBy('u.role')
      .getRawMany();
    return Object.fromEntries(rows.map((r) => [r.role, +r.count]));
  }

<<<<<<< HEAD
  async delete(id: string, reason: string): Promise<void> {
    await this.tokens.revokeAll(id);
    this.logger.warn(`user ${id} deleted: ${reason}`);
    await this.repo.softDelete(id);
=======
  async delete(id: string): Promise<boolean> {
    await this.audit.record('user.deleted', { id });
    const r = await this.repo.delete(id);
    return (r.affected ?? 0) > 0;
>>>>>>> origin/main
  }

<<<<<<< HEAD
  private static readonly DEFAULT_LIMIT = 50;
  private static readonly CACHE_TTL_SEC = 3600;
=======
  private static readonly DEFAULT_PAGE_SIZE = 25;
>>>>>>> origin/main
}

