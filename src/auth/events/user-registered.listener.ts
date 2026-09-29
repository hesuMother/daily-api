import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AuthRepository } from '../repository/auth.repository';
import {
  USER_REGISTERED_EVENT,
  UserRegisteredEvent,
} from './user-registered.event';

@Injectable()
export class UserRegisteredListener {
  constructor(private readonly repository: AuthRepository) {}

  @OnEvent(USER_REGISTERED_EVENT)
  async handle(event: UserRegisteredEvent): Promise<void> {
    await this.repository.recordRegistration(event);
  }
}
