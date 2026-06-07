import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
<<<<<<< HEAD
import { OAuthProvider } from './oauth/provider';
import { TokenStore } from './oauth/token-store';
||||||| merged common ancestors
=======
>>>>>>> origin/main
<<<<<<< HEAD
||||||| merged common ancestors
=======
import { MetricsCollector } from './metrics';
>>>>>>> origin/main
import { User } from './user.entity';
import { CreateUserInput } from './dto/create-user.input';
<<<<<<< HEAD
||||||| merged common ancestors
import { LegacyAuthAdapter } from './legacy/auth-adapter';
import { DeprecatedSessionStore } from './legacy/session-store';
=======
import { LegacyAuthAdapter } from './legacy/auth-adapter';
import { DeprecatedSessionStore } from './legacy/session-store';
>>>>>>> origin/main

@Injectable()
export class UserService {
<<<<<<< HEAD
||||||| merged common ancestors
  // TODO(@nico, 2024-Q1): remove this debug logger once metrics ship
  private readonly debugLog = process.env.DEBUG === '1';

=======
  // TODO(@nico, 2024-Q1): remove this debug logger once metrics ship
  private readonly debugLog = process.env.DEBUG === '1';

>>>>>>> origin/main
  private readonly logger = new Logger(UserService.name);

  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
<<<<<<< HEAD
    private readonly oauth: OAuthProvider,
    private readonly tokens: TokenStore,
||||||| merged common ancestors
=======
>>>>>>> origin/main
<<<<<<< HEAD
||||||| merged common ancestors
=======
    private readonly metrics: MetricsCollector,
>>>>>>> origin/main
  ) {}

  async findById(id: string): Promise<User | null> {
<<<<<<< HEAD
    const user = await this.repo.findOne({ where: { id }, relations: ['profile', 'roles'] });
||||||| merged common ancestors
    const user = await this.repo.findOne({ where: { id } });
=======
    const user = await this.repo.findOne({ where: { id }, cache: 5000 });
>>>>>>> origin/main
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
<<<<<<< HEAD
    return this.repo.findOne({ where: { email: email.toLowerCase().trim() } });
||||||| merged common ancestors
    return this.repo.findOne({ where: { email } });
=======
    return this.repo.findOne({ where: { email } });
>>>>>>> origin/main
  }

  async create(input: CreateUserInput): Promise<User> {
<<<<<<< HEAD
    const existing = await this.findByEmail(input.email);
    if (existing) throw new Error('email already taken');
    const user = this.repo.create({ ...input, createdAt: new Date() });
    const saved = await this.repo.save(user);
    await this.tokens.issue(saved.id);
    return saved;
||||||| merged common ancestors
    const user = this.repo.create(input);
    return this.repo.save(user);
=======
    const user = this.repo.create(input);
    const saved = await this.repo.save(user);
    this.metrics.recordSignup(saved.id);
    return saved;
>>>>>>> origin/main
  }

<<<<<<< HEAD
  async loginWithOAuth(code: string): Promise<User> {
    const profile = await this.oauth.exchange(code);
    let user = await this.findByEmail(profile.email);
    if (!user) user = await this.create({ email: profile.email, name: profile.name });
    await this.tokens.issue(user.id);
    return user;
  }

||||||| merged common ancestors
=======
>>>>>>> origin/main
<<<<<<< HEAD
||||||| merged common ancestors
  /** @deprecated use loginWithOAuth instead */
  async loginLegacy(username: string, password: string): Promise<User> {
    const user = await this.findByEmail(username);
    if (!user) throw new Error('not found');
    return user;
  }

=======
  /** @deprecated use loginWithOAuth instead */
  async loginLegacy(username: string, password: string): Promise<User> {
    const user = await this.findByEmail(username);
    if (!user) throw new Error('not found');
    return user;
  }

>>>>>>> origin/main
  async listAll(): Promise<User[]> {
    return this.repo.find();
  }

<<<<<<< HEAD
  async delete(id: string, reason: string): Promise<void> {
    await this.tokens.revokeAll(id);
    await this.repo.softDelete(id);
||||||| merged common ancestors
  async delete(id: string): Promise<void> {
    await this.repo.delete(id);
=======
  async delete(id: string): Promise<boolean> {
    const r = await this.repo.delete(id);
    return (r.affected ?? 0) > 0;
>>>>>>> origin/main
  }
}
