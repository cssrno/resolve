// Golden fixture exercising every classification path supported by Sections.
// Each block is annotated with the BlockClass it should produce.
//
// Layout:
//   - 2-way conflicts (no base) → always classified as `conflict`
//   - 3-way diff3 with base section → classify into add/mod/del/conflict
//
// Block ids in comments below correspond to the order they appear.

import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

// Block 1 — localAdd (one new import line on local only)
<<<<<<< HEAD
import { OAuthProvider } from './oauth/provider';
||||||| merged common ancestors
=======
>>>>>>> origin/main

// Block 2 — remoteAdd (one new import line on remote only)
<<<<<<< HEAD
||||||| merged common ancestors
=======
import { MetricsCollector } from './metrics';
>>>>>>> origin/main

// Block 3 — conflict 2-way (no base section)
<<<<<<< HEAD
import { TokenStore } from './oauth/token-store';
import { RateLimiter } from './security/rate-limiter';
=======
import { AuditLogger } from './audit';
import { SessionCache } from './cache/session';
>>>>>>> origin/main

import { User } from './user.entity';
import { CreateUserInput } from './dto/create-user.input';

// Block 4 — localMod (single-line modification)
<<<<<<< HEAD
const DEFAULT_LIMIT = 100;
||||||| merged common ancestors
const DEFAULT_LIMIT = 50;
=======
const DEFAULT_LIMIT = 50;
>>>>>>> origin/main

// Block 5 — remoteMod (single-line modification)
<<<<<<< HEAD
const DEFAULT_CACHE_TTL = 3600;
||||||| merged common ancestors
const DEFAULT_CACHE_TTL = 3600;
=======
const DEFAULT_CACHE_TTL = 7200;
>>>>>>> origin/main

// Block 6 — localDel (lines removed from local)
<<<<<<< HEAD
||||||| merged common ancestors
const LEGACY_PORT = 8080;
const LEGACY_HOST = '0.0.0.0';
=======
const LEGACY_PORT = 8080;
const LEGACY_HOST = '0.0.0.0';
>>>>>>> origin/main

// Block 7 — remoteDel (lines removed from remote)
<<<<<<< HEAD
const FEATURE_FLAG_X = process.env.FEATURE_X === '1';
const FEATURE_FLAG_Y = process.env.FEATURE_Y === '1';
||||||| merged common ancestors
const FEATURE_FLAG_X = process.env.FEATURE_X === '1';
const FEATURE_FLAG_Y = process.env.FEATURE_Y === '1';
=======
>>>>>>> origin/main

@Injectable()
export class UserService {
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
// Block 8 — localAdd multi-line (constructor params on local)
<<<<<<< HEAD
    private readonly oauth: OAuthProvider,
    private readonly tokens: TokenStore,
    private readonly limiter: RateLimiter,
||||||| merged common ancestors
=======
>>>>>>> origin/main
// Block 9 — remoteAdd multi-line (constructor params on remote)
<<<<<<< HEAD
||||||| merged common ancestors
=======
    private readonly metrics: MetricsCollector,
    private readonly audit: AuditLogger,
>>>>>>> origin/main
  ) {}

  // Block 10 — conflict 3-way (both sides changed differently from base)
  async findById(id: string): Promise<User | null> {
<<<<<<< HEAD
    await this.limiter.consume(`findById:${id}`, 1);
    const user = await this.repo.findOne({ where: { id }, relations: ['profile', 'roles'] });
    if (!user) return null;
    await this.tokens.touch(user.id);
    return user;
||||||| merged common ancestors
    return this.repo.findOne({ where: { id } });
=======
    const start = Date.now();
    const user = await this.repo.findOne({ where: { id }, cache: 5000 });
    this.metrics.recordLookup('user.findById', Date.now() - start, !!user);
    return user;
>>>>>>> origin/main
  }

  // Block 11 — localMod multi-line (refactored implementation)
  async findByEmail(email: string): Promise<User | null> {
<<<<<<< HEAD
    const normalized = email.toLowerCase().trim();
    if (!normalized) return null;
    return this.repo.findOne({ where: { email: normalized } });
||||||| merged common ancestors
    return this.repo.findOne({ where: { email } });
=======
    return this.repo.findOne({ where: { email } });
>>>>>>> origin/main
  }

  // Block 12 — remoteMod multi-line (added validation on remote)
  async create(input: CreateUserInput): Promise<User> {
<<<<<<< HEAD
    const user = this.repo.create(input);
    return this.repo.save(user);
||||||| merged common ancestors
    const user = this.repo.create(input);
    return this.repo.save(user);
=======
    if (!input.email?.match(/^[^@\s]+@[^@\s]+$/)) {
      throw new Error('invalid email format');
    }
    const user = this.repo.create(input);
    const saved = await this.repo.save(user);
    this.audit.record('user.created', { id: saved.id });
    return saved;
>>>>>>> origin/main
  }

// Block 13 — localAdd entire method (login OAuth)
<<<<<<< HEAD
  async loginWithOAuth(code: string, provider: string): Promise<{ user: User; token: string }> {
    await this.limiter.consume(`login:${provider}`, 5);
    const profile = await this.oauth.exchange(code, provider);
    let user = await this.findByEmail(profile.email);
    if (!user) {
      user = await this.create({ email: profile.email, name: profile.name });
    }
    const token = await this.tokens.issue(user.id);
    return { user, token };
  }

||||||| merged common ancestors
=======
>>>>>>> origin/main

// Block 14 — remoteAdd entire method (metrics dashboard)
<<<<<<< HEAD
||||||| merged common ancestors
=======
  async getStats(): Promise<{ total: number; perRole: Record<string, number> }> {
    const total = await this.repo.count();
    const rows = await this.repo
      .createQueryBuilder('u')
      .select('u.role', 'role')
      .addSelect('COUNT(*)', 'count')
      .groupBy('u.role')
      .getRawMany();
    return {
      total,
      perRole: Object.fromEntries(rows.map((r) => [r.role, +r.count])),
    };
  }

>>>>>>> origin/main

  // Block 15 — localDel (legacy method removed on local)
<<<<<<< HEAD
||||||| merged common ancestors
  /** @deprecated use loginWithOAuth instead */
  async loginLegacy(username: string, password: string): Promise<User> {
    const user = await this.findByEmail(username);
    if (!user || user.password !== hash(password)) {
      throw new Error('unauthorized');
    }
    return user;
  }

=======
  /** @deprecated use loginWithOAuth instead */
  async loginLegacy(username: string, password: string): Promise<User> {
    const user = await this.findByEmail(username);
    if (!user || user.password !== hash(password)) {
      throw new Error('unauthorized');
    }
    return user;
  }

>>>>>>> origin/main

  // Block 16 — remoteDel (debug helper removed on remote)
<<<<<<< HEAD
  private debugDump(): void {
    console.log('[UserService] state dump');
    console.log('  repo:', this.repo);
  }

||||||| merged common ancestors
  private debugDump(): void {
    console.log('[UserService] state dump');
    console.log('  repo:', this.repo);
  }

=======
>>>>>>> origin/main

  async listAll(filter?: { email?: string; role?: string }): Promise<User[]> {
    const query = this.repo.createQueryBuilder('user');
    if (filter?.email) query.andWhere('user.email LIKE :e', { e: `%${filter.email}%` });
    if (filter?.role)  query.andWhere('user.role = :r',     { r: filter.role });
// Block 17 — conflict (different ordering strategies)
<<<<<<< HEAD
    return query.orderBy('user.createdAt', 'DESC').take(100).getMany();
=======
    return query.orderBy('user.id', 'ASC').take(50).getMany();
>>>>>>> origin/main
  }

  // Block 18 — localMod single-line (added reason param)
<<<<<<< HEAD
  async delete(id: string, reason: string): Promise<void> {
||||||| merged common ancestors
  async delete(id: string): Promise<void> {
=======
  async delete(id: string): Promise<void> {
>>>>>>> origin/main
// Block 19 — localAdd (audit log line)
<<<<<<< HEAD
    this.logger.warn(`user ${id} removed: ${reason}`);
||||||| merged common ancestors
=======
>>>>>>> origin/main
    await this.repo.softDelete(id);
  }
}
