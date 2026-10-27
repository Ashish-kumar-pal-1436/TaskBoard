import { UserModel } from "./user.model.js";

export interface NewUser {
  email: string;
  displayName: string;
  passwordHash: string;
}

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  tokenVersion: number;
}

export interface UserRepository {
  create(input: NewUser): Promise<UserRecord>;
  findByEmail(email: string): Promise<UserRecord | null>;
  findById(id: string): Promise<UserRecord | null>;
  incrementTokenVersion(id: string): Promise<void>;
}

export class MongoUserRepository implements UserRepository {
  async create(input: NewUser): Promise<UserRecord> {
    const user = await UserModel.create(input);
    return toRecord(user);
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    const user = await UserModel.findOne({ email })
      .select("+passwordHash +tokenVersion")
      .exec();
    return user ? toRecord(user) : null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    const user = await UserModel.findById(id)
      .select("+passwordHash +tokenVersion")
      .exec();
    return user ? toRecord(user) : null;
  }

  async incrementTokenVersion(id: string): Promise<void> {
    await UserModel.updateOne({ _id: id }, { $inc: { tokenVersion: 1 } }).exec();
  }
}

function toRecord(user: {
  _id: { toString(): string };
  email: string;
  displayName: string;
  passwordHash: string;
  tokenVersion: number;
}): UserRecord {
  return {
    id: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    passwordHash: user.passwordHash,
    tokenVersion: user.tokenVersion,
  };
}
