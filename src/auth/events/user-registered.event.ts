export const USER_REGISTERED_EVENT = 'user.registered';

export class UserRegisteredEvent {
  constructor(
    public readonly userId: string,
    public readonly occurredAt: Date,
    public readonly requestId: string,
  ) {}
}
