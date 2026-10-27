import { compare, hash } from "bcryptjs";
import mongoose from "mongoose";
import { AppError } from "../src/middleware/app-error.js";
import { loadEnvironment } from "../src/config/env.js";
import {
  connectToDatabase,
  disconnectFromDatabase,
} from "../src/config/database.js";
import { AuthService } from "../src/features/auth/auth.service.js";
import {
  MongoUserRepository,
  type UserRecord,
} from "../src/features/auth/user.repository.js";
import { ProjectModel } from "../src/features/projects/project.model.js";
import {
  DEFAULT_PROJECT_COLUMNS,
  MongoProjectRepository,
} from "../src/features/projects/project.repository.js";
import { ProjectService } from "../src/features/projects/project.service.js";

const DEMO_USERS = [
  {
    email: "demo.owner@example.test",
    displayName: "Demo Owner",
    password: "Local-owner-password-2026!",
  },
  {
    email: "demo.member@example.test",
    displayName: "Demo Member",
    password: "Local-member-password-2026!",
  },
] as const;

const DEMO_PROJECT_ID = "6b0000000000000000000001";
const DEMO_COLUMN_IDS = [
  "6b0000000000000000000011",
  "6b0000000000000000000012",
  "6b0000000000000000000013",
] as const;
const DEMO_CARD_IDS = [
  "6b0000000000000000000021",
  "6b0000000000000000000022",
  "6b0000000000000000000023",
] as const;
const DEMO_PROJECT_NAME = "TaskBoard Demo Project";

class SeedSetupError extends Error {}

async function ensureDemoUser(
  users: MongoUserRepository,
  demoUser: (typeof DEMO_USERS)[number],
): Promise<UserRecord> {
  const existing = await users.findByEmail(demoUser.email);
  if (existing) return verifyDemoPassword(existing, demoUser.password);

  try {
    return await users.create({
      email: demoUser.email,
      displayName: demoUser.displayName,
      passwordHash: await hash(demoUser.password, 12),
    });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;

    const concurrentUser = await users.findByEmail(demoUser.email);
    if (!concurrentUser) throw error;
    return verifyDemoPassword(concurrentUser, demoUser.password);
  }
}

async function verifyDemoPassword(
  user: UserRecord,
  password: string,
): Promise<UserRecord> {
  if (!(await compare(password, user.passwordHash))) {
    throw new SeedSetupError(
      `The demo email ${user.email} already belongs to an account with a different password; it was not changed.`,
    );
  }
  return user;
}

async function ensureDemoProject(
  ownerId: string,
  memberId: string,
): Promise<void> {
  const projectId = new mongoose.Types.ObjectId(DEMO_PROJECT_ID);
  const existing = await ProjectModel.findById(projectId).exec();
  if (!existing) {
    const createdAt = new Date();
    const ownerObjectId = new mongoose.Types.ObjectId(ownerId);
    const memberObjectId = new mongoose.Types.ObjectId(memberId);
    const columns = DEFAULT_PROJECT_COLUMNS.map((name, position) => ({
      _id: new mongoose.Types.ObjectId(DEMO_COLUMN_IDS[position]),
      name,
      position,
    }));
    const cards = [
      {
        _id: new mongoose.Types.ObjectId(DEMO_CARD_IDS[0]),
        columnId: new mongoose.Types.ObjectId(DEMO_COLUMN_IDS[0]),
        title: "Plan the release checklist",
        description: "Capture launch requirements and owners.",
        assigneeId: ownerObjectId,
        dueDate: null,
        labels: ["Planning"],
        comments: [],
        position: 0,
        createdAt,
        updatedAt: createdAt,
      },
      {
        _id: new mongoose.Types.ObjectId(DEMO_CARD_IDS[1]),
        columnId: new mongoose.Types.ObjectId(DEMO_COLUMN_IDS[1]),
        title: "Review the onboarding flow",
        description: "Check the first-run experience on desktop and mobile.",
        assigneeId: memberObjectId,
        dueDate: null,
        labels: ["Design", "Review"],
        comments: [],
        position: 0,
        createdAt,
        updatedAt: createdAt,
      },
      {
        _id: new mongoose.Types.ObjectId(DEMO_CARD_IDS[2]),
        columnId: new mongoose.Types.ObjectId(DEMO_COLUMN_IDS[2]),
        title: "Create the project workspace",
        description: "Set up the initial project board.",
        assigneeId: ownerObjectId,
        dueDate: null,
        labels: ["Setup"],
        comments: [],
        position: 0,
        createdAt,
        updatedAt: createdAt,
      },
    ];

    try {
      await ProjectModel.updateOne(
        { _id: projectId },
        {
          $setOnInsert: {
            name: DEMO_PROJECT_NAME,
            ownerId: ownerObjectId,
            members: [
              { userId: ownerObjectId, role: "owner" },
              { userId: memberObjectId, role: "member" },
            ],
            columns,
            cards,
            activities: [],
          },
        },
        { upsert: true, runValidators: true },
      ).exec();
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
    }
  }

  const project = await ProjectModel.findById(projectId).exec();
  const ownerMember = project?.members.find(
    (member) => member.userId.toString() === ownerId,
  );
  const projectMember = project?.members.find(
    (member) => member.userId.toString() === memberId,
  );
  const hasSeedColumns = DEMO_COLUMN_IDS.every((id) =>
    project?.columns.some((column) => column._id.toString() === id),
  );
  const hasSeedCards = DEMO_CARD_IDS.every((id) =>
    project?.cards.some((card) => card._id.toString() === id),
  );

  if (
    !project ||
    project.name !== DEMO_PROJECT_NAME ||
    project.ownerId.toString() !== ownerId ||
    ownerMember?.role !== "owner" ||
    projectMember?.role !== "member" ||
    !hasSeedColumns ||
    !hasSeedCards
  ) {
    throw new SeedSetupError(
      "The fixed demo project ID is already in use by incompatible data; no existing project was changed.",
    );
  }
}

async function verifyDemoAccess(
  users: MongoUserRepository,
  owner: UserRecord,
  member: UserRecord,
  jwtSecret: string,
  tokenTtlSeconds: number,
): Promise<void> {
  const auth = new AuthService(users, jwtSecret, tokenTtlSeconds);
  await auth.login({ email: DEMO_USERS[0].email, password: DEMO_USERS[0].password });
  await auth.login({ email: DEMO_USERS[1].email, password: DEMO_USERS[1].password });

  const projectService = new ProjectService(
    new MongoProjectRepository(),
    users,
  );
  const ownerProject = await projectService.getForMember(DEMO_PROJECT_ID, owner.id);
  const memberProject = await projectService.getForMember(DEMO_PROJECT_ID, member.id);
  const memberProjects = await projectService.listForMember(member.id);
  if (
    ownerProject.role !== "owner" ||
    memberProject.role !== "member" ||
    !memberProjects.some((project) => project.id === DEMO_PROJECT_ID)
  ) {
    throw new SeedSetupError("Demo project membership verification failed.");
  }

  try {
    await projectService.createColumn(DEMO_PROJECT_ID, member.id, "Unauthorized");
  } catch (error) {
    if (error instanceof AppError && error.code === "OWNER_REQUIRED") return;
    throw error;
  }
  throw new SeedSetupError("The demo member unexpectedly passed an owner-only permission check.");
}

function isDuplicateKeyError(error: unknown): error is { code: number } {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === 11000
  );
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === "production") {
    throw new SeedSetupError("Demo seeding is disabled when NODE_ENV=production.");
  }

  const parsedEnvironment = loadEnvironment();
  if (!parsedEnvironment.success) {
    const invalidSettings = [
      ...new Set(
        parsedEnvironment.error.issues.map((issue) => String(issue.path[0] ?? "environment")),
      ),
    ];
    throw new SeedSetupError(
      `Invalid development configuration: ${invalidSettings.join(", ")}.`,
    );
  }
  const environment = parsedEnvironment.data;
  if (environment.NODE_ENV !== "development") {
    throw new SeedSetupError("Demo seeding is only allowed when NODE_ENV=development.");
  }

  const users = new MongoUserRepository();
  let connected = false;
  try {
    await connectToDatabase(environment.MONGODB_URI);
    connected = true;
    const [owner, member] = await Promise.all(
      DEMO_USERS.map((demoUser) => ensureDemoUser(users, demoUser)),
    );
    await ensureDemoProject(owner.id, member.id);
    await verifyDemoAccess(
      users,
      owner,
      member,
      environment.JWT_SECRET,
      environment.JWT_ACCESS_TOKEN_TTL_SECONDS,
    );
    console.log(
      `Demo seed is ready: ${DEMO_USERS[0].email}, ${DEMO_USERS[1].email}, and "${DEMO_PROJECT_NAME}".`,
    );
  } finally {
    if (connected) await disconnectFromDatabase();
  }
}

main().catch((error: unknown) => {
  if (error instanceof SeedSetupError) {
    console.error(error.message);
  } else {
    console.error(
      `Demo seed failed (${error instanceof Error ? error.name : "unknown error"}). Check MongoDB availability and development configuration.`,
    );
  }
  process.exitCode = 1;
});
