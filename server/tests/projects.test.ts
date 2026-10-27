import mongoose from "mongoose";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { AuthService } from "../src/features/auth/auth.service.js";
import type {
  NewUser,
  UserRecord,
  UserRepository,
} from "../src/features/auth/user.repository.js";
import {
  ProjectService,
} from "../src/features/projects/project.service.js";
import type {
  NewCard,
  NewProject,
  ProjectRecord,
  ProjectRepository,
} from "../src/features/projects/project.repository.js";
import {
  DEFAULT_PROJECT_COLUMNS,
  type ProjectColumnRecord,
} from "../src/features/projects/project.repository.js";

const SECRET = "test-secret-that-is-at-least-thirty-two-characters";

class MemoryUserRepository implements UserRepository {
  private readonly records = new Map<string, UserRecord>();

  async create(input: NewUser): Promise<UserRecord> {
    const user: UserRecord = {
      id: new mongoose.Types.ObjectId().toString(),
      ...input,
      tokenVersion: 0,
    };
    this.records.set(user.id, user);
    return user;
  }

  async findByEmail(email: string): Promise<UserRecord | null> {
    return [...this.records.values()].find((user) => user.email === email) ?? null;
  }

  async findById(id: string): Promise<UserRecord | null> {
    return this.records.get(id) ?? null;
  }

  async incrementTokenVersion(id: string): Promise<void> {
    const user = this.records.get(id);
    if (user) user.tokenVersion += 1;
  }
}

class MemoryProjectRepository implements ProjectRepository {
  private readonly records = new Map<string, ProjectRecord>();

  async create(input: NewProject): Promise<ProjectRecord> {
    const now = new Date();
    const project: ProjectRecord = {
      id: new mongoose.Types.ObjectId().toString(),
      name: input.name,
      ownerId: input.ownerId,
      members: [{ userId: input.ownerId, role: "owner" }],
      columns: DEFAULT_PROJECT_COLUMNS.map((name, position) => ({
        id: new mongoose.Types.ObjectId().toString(),
        name,
        position,
      })),
      cards: [],
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    this.records.set(project.id, project);
    return project;
  }

  async listForMember(userId: string): Promise<ProjectRecord[]> {
    return [...this.records.values()].filter((project) =>
      project.members.some((member) => member.userId === userId),
    );
  }

  async findById(id: string): Promise<ProjectRecord | null> {
    return this.records.get(id) ?? null;
  }

  async addMember(projectId: string, userId: string): Promise<ProjectRecord | null> {
    const project = this.records.get(projectId);
    if (!project || project.members.some((member) => member.userId === userId)) {
      return null;
    }
    project.members.push({ userId, role: "member" });
    return project;
  }

  async createColumn(projectId: string, name: string): Promise<ProjectRecord | null> {
    const project = this.records.get(projectId);
    if (!project) return null;
    project.columns.push({
      id: new mongoose.Types.ObjectId().toString(),
      name,
      position: project.columns.length,
    });
    return project;
  }

  async renameColumn(
    projectId: string,
    columnId: string,
    name: string,
  ): Promise<ProjectRecord | null> {
    const project = this.records.get(projectId);
    const column = project?.columns.find((item) => item.id === columnId);
    if (!project || !column) return null;
    column.name = name;
    return project;
  }

  async reorderColumns(
    projectId: string,
    columnIds: string[],
  ): Promise<ProjectRecord | null> {
    const project = this.records.get(projectId);
    if (!project) return null;
    const byId = new Map(project.columns.map((column) => [column.id, column]));
    if (columnIds.length !== byId.size || columnIds.some((id) => !byId.has(id))) {
      return null;
    }
    project.columns = columnIds.map((id, position) => ({
      ...byId.get(id)!,
      position,
    }));
    return project;
  }

  async createCard(projectId: string, input: NewCard): Promise<ProjectRecord | null> {
    const project = this.records.get(projectId);
    if (!project) return null;
    const lastPosition = project.cards
      .filter((card) => card.columnId === input.columnId)
      .reduce((max, card) => Math.max(max, card.position), 0);
    const now = new Date();
    project.cards.push({
      id: new mongoose.Types.ObjectId().toString(),
      ...input,
      position: lastPosition + 1,
      createdAt: now,
      updatedAt: now,
    });
    project.version += 1;
    return project;
  }

  async updateCard(
    projectId: string,
    cardId: string,
    fields: Partial<Omit<NewCard, "columnId">>,
  ): Promise<ProjectRecord | null> {
    const project = this.records.get(projectId);
    const card = project?.cards.find((item) => item.id === cardId);
    if (!project || !card) return null;
    Object.assign(card, fields, { updatedAt: new Date() });
    project.version += 1;
    return project;
  }

  async deleteCard(projectId: string, cardId: string): Promise<ProjectRecord | null> {
    const project = this.records.get(projectId);
    if (!project) return null;
    const index = project.cards.findIndex((card) => card.id === cardId);
    if (index < 0) return null;
    project.cards.splice(index, 1);
    project.version += 1;
    return project;
  }

  async moveCard(
    projectId: string,
    cardId: string,
    columnId: string,
    position: number,
    expectedVersion: number,
  ): Promise<ProjectRecord | null> {
    const project = this.records.get(projectId);
    const card = project?.cards.find((item) => item.id === cardId);
    if (!project || !card || project.version !== expectedVersion) return null;
    card.columnId = columnId;
    card.position = position;
    card.updatedAt = new Date();
    project.version += 1;
    return project;
  }

  getColumns(projectId: string): ProjectColumnRecord[] {
    return this.records.get(projectId)?.columns ?? [];
  }
}

function setup() {
  const users = new MemoryUserRepository();
  const projects = new MemoryProjectRepository();
  const auth = new AuthService(users, SECRET, 900);
  const app = createApp(
    {
      CLIENT_ORIGIN: "http://localhost:5173",
      NODE_ENV: "test",
      JWT_SECRET: SECRET,
      JWT_ACCESS_TOKEN_TTL_SECONDS: 900,
    },
    auth,
    new ProjectService(projects, users),
  );
  return { app, projects };
}

async function register(
  app: ReturnType<typeof setup>["app"],
  email: string,
) {
  const agent = request.agent(app);
  const response = await agent.post("/api/auth/register").send({
    email,
    displayName: "Project User",
    password: "A-good-password-42",
  });
  expect(response.status).toBe(201);
  return { agent, userId: response.body.user.id as string };
}

describe("project APIs", () => {
  it("rejects unauthenticated project requests", async () => {
    const { app } = setup();
    const create = await request(app).post("/api/projects").send({ name: "Website" });
    const list = await request(app).get("/api/projects");
    const detail = await request(app).get(
      `/api/projects/${new mongoose.Types.ObjectId().toString()}`,
    );
    const addMember = await request(app)
      .post(`/api/projects/${new mongoose.Types.ObjectId().toString()}/members`)
      .send({ email: "member@example.com" });

    expect(create.status).toBe(401);
    expect(create.body.error.code).toBe("UNAUTHENTICATED");
    expect(list.status).toBe(401);
    expect(list.body.error.code).toBe("UNAUTHENTICATED");
    expect(detail.status).toBe(401);
    expect(detail.body.error.code).toBe("UNAUTHENTICATED");
    expect(addMember.status).toBe(401);
    expect(addMember.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("creates a project with the authenticated user as owner", async () => {
    const { app } = setup();
    const { agent, userId } = await register(app, "owner@example.com");
    const response = await agent.post("/api/projects").send({ name: "Website refresh" });

    expect(response.status).toBe(201);
    expect(response.body.project).toMatchObject({
      name: "Website refresh",
      ownerId: userId,
      role: "owner",
    });
  });

  describe("project column APIs", () => {
    it("creates and lists the default columns with each new project", async () => {
      const { app } = setup();
      const owner = await register(app, "columns-default@example.com");
      const created = await owner.agent
        .post("/api/projects")
        .send({ name: "Default board" });

      const response = await owner.agent.get(
        `/api/projects/${created.body.project.id}/columns`,
      );

      expect(response.status).toBe(200);
      expect(response.body.columns.map((column: { name: string }) => column.name)).toEqual([
        "To Do",
        "In Progress",
        "Done",
      ]);
      expect(response.body.columns.map((column: { position: number }) => column.position)).toEqual([
        0,
        1,
        2,
      ]);
    });

    it("allows an authenticated project member to list columns", async () => {
      const { app } = setup();
      const owner = await register(app, "columns-member-owner@example.com");
      const member = await register(app, "columns-member@example.com");
      const created = await owner.agent
        .post("/api/projects")
        .send({ name: "Member board" });
      await owner.agent
        .post(`/api/projects/${created.body.project.id}/members`)
        .send({ email: "columns-member@example.com" });

      const response = await member.agent.get(
        `/api/projects/${created.body.project.id}/columns`,
      );

      expect(response.status).toBe(200);
      expect(response.body.columns).toHaveLength(3);
    });

    it("allows an owner to create a column", async () => {
      const { app } = setup();
      const owner = await register(app, "columns-create@example.com");
      const created = await owner.agent
        .post("/api/projects")
        .send({ name: "Create column board" });

      const response = await owner.agent
        .post(`/api/projects/${created.body.project.id}/columns`)
        .send({ name: "Review" });

      expect(response.status).toBe(201);
      expect(response.body.columns).toHaveLength(4);
      expect(response.body.columns[3]).toMatchObject({
        name: "Review",
        position: 3,
      });
    });

    describe("project card APIs", () => {
      async function createBoard(
        app: ReturnType<typeof setup>["app"],
        ownerEmail: string,
        projectName: string,
      ) {
        const owner = await register(app, ownerEmail);
        const created = await owner.agent.post("/api/projects").send({ name: projectName });
        const columnResponse = await owner.agent.get(
          `/api/projects/${created.body.project.id}/columns`,
        );
        return {
          owner,
          projectId: created.body.project.id as string,
          columnId: columnResponse.body.columns[0].id as string,
        };
      }

      it("creates and lists a card with validated fields and persisted position", async () => {
        const { app } = setup();
        const { owner, projectId, columnId } = await createBoard(
          app,
          "cards-create@example.com",
          "Card board",
        );
        const create = await owner.agent.post(`/api/projects/${projectId}/cards`).send({
          columnId,
          title: "  Ship the first version  ",
          description: "A short project description",
          assigneeId: owner.userId,
          dueDate: "2027-01-15T00:00:00.000Z",
          labels: ["Planning", "Frontend"],
        });
        const list = await owner.agent.get(`/api/projects/${projectId}/cards`);

        expect(create.status).toBe(201);
        expect(create.body.cards[0]).toMatchObject({
          title: "Ship the first version",
          description: "A short project description",
          columnId,
          assigneeId: owner.userId,
          labels: ["Planning", "Frontend"],
          position: 1,
        });
        expect(create.body.cards[0].dueDate).toBe("2027-01-15T00:00:00.000Z");
        expect(list.status).toBe(200);
        expect(list.body.cards).toEqual(create.body.cards);
      });

      it("updates and deletes a card", async () => {
        const { app } = setup();
        const { owner, projectId, columnId } = await createBoard(
          app,
          "cards-edit@example.com",
          "Editing board",
        );
        const created = await owner.agent.post(`/api/projects/${projectId}/cards`).send({
          columnId,
          title: "Original title",
        });
        const cardId = created.body.cards[0].id as string;
        const update = await owner.agent.patch(
          `/api/projects/${projectId}/cards/${cardId}`,
        ).send({
          title: "Updated title",
          description: "Updated description",
          dueDate: null,
          labels: ["Ready"],
        });
        const remove = await owner.agent.delete(
          `/api/projects/${projectId}/cards/${cardId}`,
        );
        const list = await owner.agent.get(`/api/projects/${projectId}/cards`);

        expect(update.status).toBe(200);
        expect(update.body.cards[0]).toMatchObject({
          title: "Updated title",
          description: "Updated description",
          dueDate: null,
          labels: ["Ready"],
        });
        expect(remove.status).toBe(204);
        expect(list.body.cards).toEqual([]);
      });

      it("rejects malformed or invalid card data", async () => {
        const { app } = setup();
        const { owner, projectId, columnId } = await createBoard(
          app,
          "cards-validation@example.com",
          "Validation board",
        );
        const invalidTitle = await owner.agent.post(`/api/projects/${projectId}/cards`).send({
          columnId,
          title: " ",
        });
        const invalidDate = await owner.agent.post(`/api/projects/${projectId}/cards`).send({
          columnId,
          title: "Valid title",
          dueDate: "not-a-date",
        });
        const untrustedPosition = await owner.agent
          .post(`/api/projects/${projectId}/cards`)
          .send({ columnId, title: "Valid title", position: 999 });
        const malformedCardId = await owner.agent
          .delete(`/api/projects/${projectId}/cards/not-an-id`);
        const emptyUpdate = await owner.agent
          .patch(`/api/projects/${projectId}/cards/${new mongoose.Types.ObjectId()}`)
          .send({});

        for (const response of [invalidTitle, invalidDate, untrustedPosition, malformedCardId, emptyUpdate]) {
          expect(response.status).toBe(400);
          expect(response.body.error.code).toBe("VALIDATION_ERROR");
        }
      });

      it("requires authentication and project membership for card endpoints", async () => {
        const { app } = setup();
        const { owner, projectId, columnId } = await createBoard(
          app,
          "cards-member-owner@example.com",
          "Member-only cards",
        );
        const outsider = await register(app, "cards-outsider@example.com");
        const unauthenticated = await request(app).get(`/api/projects/${projectId}/cards`);
        const hiddenList = await outsider.agent.get(`/api/projects/${projectId}/cards`);
        const hiddenCreate = await outsider.agent.post(`/api/projects/${projectId}/cards`).send({
          columnId,
          title: "No access",
        });

        expect(unauthenticated.status).toBe(401);
        expect(hiddenList.status).toBe(404);
        expect(hiddenCreate.status).toBe(404);
        expect(hiddenList.body.error.code).toBe("PROJECT_NOT_FOUND");
        expect(hiddenCreate.body.error.code).toBe("PROJECT_NOT_FOUND");
        expect(owner.userId).toBeTruthy();
      });

      it("rejects columns from another project and non-member assignees", async () => {
        const { app } = setup();
        const first = await createBoard(app, "cards-cross-owner@example.com", "First");
        const second = await first.owner.agent.post("/api/projects").send({ name: "Second" });
        const secondColumns = await first.owner.agent.get(
          `/api/projects/${second.body.project.id}/columns`,
        );
        const invalidColumn = await first.owner.agent
          .post(`/api/projects/${first.projectId}/cards`)
          .send({ columnId: secondColumns.body.columns[0].id, title: "Wrong board" });
        const outsider = await register(app, "cards-unassigned@example.com");
        const invalidAssignee = await first.owner.agent
          .post(`/api/projects/${first.projectId}/cards`)
          .send({ columnId: first.columnId, title: "Wrong assignee", assigneeId: outsider.userId });

        expect(invalidColumn.status).toBe(404);
        expect(invalidColumn.body.error.code).toBe("COLUMN_NOT_FOUND");
        expect(invalidAssignee.status).toBe(400);
        expect(invalidAssignee.body.error.code).toBe("INVALID_ASSIGNEE");
      });

      it("allows a project member to create cards and assign another project member", async () => {
        const { app } = setup();
        const board = await createBoard(app, "cards-member-owner@example.com", "Team cards");
        const member = await register(app, "cards-member-user@example.com");
        const memberId = member.userId;
        await board.owner.agent
          .post(`/api/projects/${board.projectId}/members`)
          .send({ email: "cards-member-user@example.com" });

        const response = await member.agent
          .post(`/api/projects/${board.projectId}/cards`)
          .send({
            columnId: board.columnId,
            title: "Member-created card",
            assigneeId: board.owner.userId,
          });

        expect(response.status).toBe(201);
        expect(response.body.cards[0]).toMatchObject({
          title: "Member-created card",
          assigneeId: board.owner.userId,
        });
        expect(memberId).not.toBe(board.owner.userId);
      });

      it("does not allow a card to be read, edited, deleted, or moved through another project", async () => {
        const { app } = setup();
        const board = await createBoard(app, "cards-isolation@example.com", "Card owner");
        const other = await board.owner.agent.post("/api/projects").send({ name: "Other project" });
        const otherColumnResponse = await board.owner.agent.get(
          `/api/projects/${other.body.project.id}/columns`,
        );
        const card = await board.owner.agent.post(`/api/projects/${board.projectId}/cards`).send({
          columnId: board.columnId,
          title: "Private card",
        });
        const cardId = card.body.cards[0].id as string;
        const otherColumnId = otherColumnResponse.body.columns[0].id as string;

        const update = await board.owner.agent
          .patch(`/api/projects/${other.body.project.id}/cards/${cardId}`)
          .send({ title: "Cross-project update" });
        const remove = await board.owner.agent.delete(
          `/api/projects/${other.body.project.id}/cards/${cardId}`,
        );
        const move = await board.owner.agent
          .patch(`/api/projects/${other.body.project.id}/cards/${cardId}/move`)
          .send({ columnId: otherColumnId });
        const original = await board.owner.agent.get(`/api/projects/${board.projectId}/cards`);

        expect(update.status).toBe(404);
        expect(remove.status).toBe(404);
        expect(move.status).toBe(404);
        expect(original.body.cards[0].title).toBe("Private card");
      });

      it("moves cards between columns and persists fractional ordering", async () => {
        const { app } = setup();
        const board = await createBoard(app, "cards-move@example.com", "Moving board");
        const secondColumnResponse = await board.owner.agent
          .post(`/api/projects/${board.projectId}/columns`)
          .send({ name: "Next" });
        const secondColumnId = secondColumnResponse.body.columns[1].id as string;
        await board.owner.agent.post(`/api/projects/${board.projectId}/cards`).send({
          columnId: secondColumnId,
          title: "First",
        });
        const second = await board.owner.agent.post(`/api/projects/${board.projectId}/cards`).send({
          columnId: secondColumnId,
          title: "Second",
        });
        const third = await board.owner.agent.post(`/api/projects/${board.projectId}/cards`).send({
          columnId: board.columnId,
          title: "Third",
        });
        const secondCardId = second.body.cards.find((card: { title: string }) => card.title === "Second")
          .id as string;
        const thirdCardId = third.body.cards.find((card: { title: string }) => card.title === "Third")
          .id as string;

        const moved = await board.owner.agent
          .patch(`/api/projects/${board.projectId}/cards/${thirdCardId}/move`)
          .send({ columnId: secondColumnId, beforeCardId: secondCardId });
        const persisted = await board.owner.agent.get(`/api/projects/${board.projectId}/cards`);
        const destination = persisted.body.cards.filter(
          (card: { columnId: string }) => card.columnId === secondColumnId,
        );

        expect(moved.status).toBe(200);
        expect(destination.map((card: { title: string }) => card.title)).toEqual([
          "First",
          "Third",
          "Second",
        ]);
        expect(destination[1].position).toBe(1.5);
        expect(destination[1].position).toBeLessThan(destination[2].position);
        expect(destination[0].position).toBeGreaterThan(0);
        expect(persisted.body.cards).toEqual(moved.body.cards);
      });
    });

    it("allows an owner to rename a column", async () => {
      const { app } = setup();
      const owner = await register(app, "columns-rename@example.com");
      const created = await owner.agent
        .post("/api/projects")
        .send({ name: "Rename board" });
      const columns = await owner.agent.get(
        `/api/projects/${created.body.project.id}/columns`,
      );
      const columnId = columns.body.columns[0].id as string;

      const response = await owner.agent
        .patch(`/api/projects/${created.body.project.id}/columns/${columnId}`)
        .send({ name: "Backlog" });

      expect(response.status).toBe(200);
      expect(response.body.columns[0]).toMatchObject({
        id: columnId,
        name: "Backlog",
        position: 0,
      });
    });

    it("allows an owner to reorder all columns and persists the new order", async () => {
      const { app } = setup();
      const owner = await register(app, "columns-reorder@example.com");
      const created = await owner.agent
        .post("/api/projects")
        .send({ name: "Reorder board" });
      const columns = await owner.agent.get(
        `/api/projects/${created.body.project.id}/columns`,
      );
      const columnIds = (columns.body.columns as Array<{ id: string }>)
        .map((column) => column.id)
        .reverse();

      const response = await owner.agent
        .patch(`/api/projects/${created.body.project.id}/columns/reorder`)
        .send({ columnIds });
      const refreshed = await owner.agent.get(
        `/api/projects/${created.body.project.id}/columns`,
      );

      expect(response.status).toBe(200);
      expect(response.body.columns.map((column: { id: string }) => column.id)).toEqual(
        columnIds,
      );
      expect(refreshed.body.columns.map((column: { id: string }) => column.id)).toEqual(
        columnIds,
      );
      expect(refreshed.body.columns.map((column: { position: number }) => column.position)).toEqual([
        0,
        1,
        2,
      ]);
    });

    it("rejects unauthenticated access to every column endpoint", async () => {
      const { app } = setup();
      const projectId = new mongoose.Types.ObjectId().toString();
      const columnId = new mongoose.Types.ObjectId().toString();
      const requests = [
        request(app).get(`/api/projects/${projectId}/columns`),
        request(app).post(`/api/projects/${projectId}/columns`).send({ name: "Review" }),
        request(app)
          .patch(`/api/projects/${projectId}/columns/${columnId}`)
          .send({ name: "Review" }),
        request(app)
          .patch(`/api/projects/${projectId}/columns/reorder`)
          .send({ columnIds: [columnId] }),
      ];

      const responses = await Promise.all(requests);

      for (const response of responses) {
        expect(response.status).toBe(401);
        expect(response.body.error.code).toBe("UNAUTHENTICATED");
      }
    });

    it("hides columns from non-members and prevents members from managing them", async () => {
      const { app } = setup();
      const owner = await register(app, "columns-owner-only@example.com");
      const member = await register(app, "columns-owner-only-member@example.com");
      const outsider = await register(app, "columns-outsider@example.com");
      const created = await owner.agent
        .post("/api/projects")
        .send({ name: "Private columns" });
      await owner.agent
        .post(`/api/projects/${created.body.project.id}/members`)
        .send({ email: "columns-owner-only-member@example.com" });

      const hidden = await outsider.agent.get(
        `/api/projects/${created.body.project.id}/columns`,
      );
      const outsiderWrite = await outsider.agent
        .post(`/api/projects/${created.body.project.id}/columns`)
        .send({ name: "Hidden" });
      const memberWrite = await member.agent
        .post(`/api/projects/${created.body.project.id}/columns`)
        .send({ name: "Forbidden" });
      const initialColumns = await owner.agent.get(
        `/api/projects/${created.body.project.id}/columns`,
      );
      const memberRename = await member.agent
        .patch(
          `/api/projects/${created.body.project.id}/columns/${initialColumns.body.columns[0].id}`,
        )
        .send({ name: "Forbidden rename" });
      const memberReorder = await member.agent
        .patch(`/api/projects/${created.body.project.id}/columns/reorder`)
        .send({
          columnIds: initialColumns.body.columns
            .map((column: { id: string }) => column.id)
            .reverse(),
        });

      expect(hidden.status).toBe(404);
      expect(hidden.body.error.code).toBe("PROJECT_NOT_FOUND");
      expect(outsiderWrite.status).toBe(404);
      expect(outsiderWrite.body.error.code).toBe("PROJECT_NOT_FOUND");
      expect(memberWrite.status).toBe(403);
      expect(memberWrite.body.error.code).toBe("OWNER_REQUIRED");
      expect(memberRename.status).toBe(403);
      expect(memberRename.body.error.code).toBe("OWNER_REQUIRED");
      expect(memberReorder.status).toBe(403);
      expect(memberReorder.body.error.code).toBe("OWNER_REQUIRED");
    });

    it("rejects invalid names, IDs, and reorder lists that omit or repeat columns", async () => {
      const { app } = setup();
      const owner = await register(app, "columns-validation@example.com");
      const created = await owner.agent
        .post("/api/projects")
        .send({ name: "Validation board" });
      const list = await owner.agent.get(
        `/api/projects/${created.body.project.id}/columns`,
      );
      const ids = (list.body.columns as Array<{ id: string }>).map((column) => column.id);
      const requests = [
        owner.agent
          .post(`/api/projects/${created.body.project.id}/columns`)
          .send({ name: " " }),
        owner.agent
          .get("/api/projects/not-an-object-id/columns"),
        owner.agent
          .patch(`/api/projects/${created.body.project.id}/columns/bad-id`)
          .send({ name: "Renamed" }),
        owner.agent
          .patch(`/api/projects/${created.body.project.id}/columns/reorder`)
          .send({ columnIds: [ids[0], ids[1]] }),
        owner.agent
          .patch(`/api/projects/${created.body.project.id}/columns/reorder`)
          .send({ columnIds: [ids[0], ids[0], ids[2]] }),
      ];

      const responses = await Promise.all(requests);

      for (const index of [0, 1, 2, 4]) {
        expect(responses[index].status).toBe(400);
        expect(responses[index].body.error.code).toBe("VALIDATION_ERROR");
      }
      expect(responses[3].status).toBe(400);
      expect(responses[3].body.error.code).toBe("INVALID_COLUMN_ORDER");
    });

    it("does not rename or reorder columns through a different project ID", async () => {
      const { app } = setup();
      const owner = await register(app, "columns-isolation@example.com");
      const first = await owner.agent
        .post("/api/projects")
        .send({ name: "First board" });
      const second = await owner.agent
        .post("/api/projects")
        .send({ name: "Second board" });
      const firstColumns = await owner.agent.get(
        `/api/projects/${first.body.project.id}/columns`,
      );
      const secondColumns = await owner.agent.get(
        `/api/projects/${second.body.project.id}/columns`,
      );
      const foreignColumnId = firstColumns.body.columns[0].id as string;

      const rename = await owner.agent
        .patch(`/api/projects/${second.body.project.id}/columns/${foreignColumnId}`)
        .send({ name: "Cross-project edit" });
      const reorder = await owner.agent
        .patch(`/api/projects/${second.body.project.id}/columns/reorder`)
        .send({
          columnIds: firstColumns.body.columns.map((column: { id: string }) => column.id),
        });
      const unchanged = await owner.agent.get(
        `/api/projects/${second.body.project.id}/columns`,
      );

      expect(rename.status).toBe(404);
      expect(rename.body.error.code).toBe("COLUMN_NOT_FOUND");
      expect(reorder.status).toBe(400);
      expect(reorder.body.error.code).toBe("INVALID_COLUMN_ORDER");
      expect(unchanged.body.columns.map((column: { name: string }) => column.name)).toEqual([
        "To Do",
        "In Progress",
        "Done",
      ]);
      expect(secondColumns.body.columns[0].name).toBe("To Do");
    });
  });

  it("lists only projects the current user belongs to", async () => {
    const { app } = setup();
    const first = await register(app, "first@example.com");
    const second = await register(app, "second@example.com");
    const ownProject = await first.agent
      .post("/api/projects")
      .send({ name: "First user's project" });
    const otherProject = await second.agent
      .post("/api/projects")
      .send({ name: "Second user's project" });

    const response = await first.agent.get("/api/projects");

    expect(response.status).toBe(200);
    expect(response.body.projects.map((project: { id: string }) => project.id)).toEqual([
      ownProject.body.project.id,
    ]);
    expect(
      response.body.projects.some(
        (project: { id: string }) => project.id === otherProject.body.project.id,
      ),
    ).toBe(false);
  });

  it("does not allow a non-member to retrieve project details", async () => {
    const { app } = setup();
    const owner = await register(app, "detail-owner@example.com");
    const nonMember = await register(app, "outsider@example.com");
    const created = await owner.agent
      .post("/api/projects")
      .send({ name: "Private project" });

    const response = await nonMember.agent.get(
      `/api/projects/${created.body.project.id}`,
    );

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("allows a project member to retrieve project details", async () => {
    const { app } = setup();
    const owner = await register(app, "member-owner@example.com");
    const member = await register(app, "member@example.com");
    const created = await owner.agent
      .post("/api/projects")
      .send({ name: "Shared project" });
    const addMember = await owner.agent
      .post(`/api/projects/${created.body.project.id}/members`)
      .send({ email: "member@example.com" });
    expect(addMember.status).toBe(201);

    const response = await member.agent.get(
      `/api/projects/${created.body.project.id}`,
    );

    expect(response.status).toBe(200);
    expect(response.body.project).toMatchObject({
      id: created.body.project.id,
      name: "Shared project",
      ownerId: owner.userId,
      role: "member",
    });
  });

  it("allows the owner to add an existing user by email", async () => {
    const { app } = setup();
    const owner = await register(app, "membership-owner@example.com");
    const member = await register(app, "new-member@example.com");
    const created = await owner.agent
      .post("/api/projects")
      .send({ name: "Team project" });

    const response = await owner.agent
      .post(`/api/projects/${created.body.project.id}/members`)
      .send({ email: " NEW-MEMBER@example.com " });
    const memberProjectList = await member.agent.get("/api/projects");

    expect(response.status).toBe(201);
    expect(response.body.project).toMatchObject({
      id: created.body.project.id,
      role: "member",
      ownerId: owner.userId,
    });
    expect(memberProjectList.body.projects).toEqual([
      expect.objectContaining({ id: created.body.project.id, role: "member" }),
    ]);
  });

  it("does not allow a non-owner member to add users", async () => {
    const { app } = setup();
    const owner = await register(app, "role-owner@example.com");
    const member = await register(app, "role-member@example.com");
    await register(app, "role-target@example.com");
    const created = await owner.agent
      .post("/api/projects")
      .send({ name: "Owner-only changes" });
    await owner.agent
      .post(`/api/projects/${created.body.project.id}/members`)
      .send({ email: "role-member@example.com" });

    const response = await member.agent
      .post(`/api/projects/${created.body.project.id}/members`)
      .send({ email: "role-target@example.com" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("PROJECT_NOT_FOUND");
  });

  it("rejects attempts to add an unknown user", async () => {
    const { app } = setup();
    const owner = await register(app, "unknown-owner@example.com");
    const created = await owner.agent
      .post("/api/projects")
      .send({ name: "Known team" });

    const response = await owner.agent
      .post(`/api/projects/${created.body.project.id}/members`)
      .send({ email: "missing@example.com" });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe("USER_NOT_FOUND");
  });

  it("rejects duplicate membership, including adding the owner again", async () => {
    const { app } = setup();
    const owner = await register(app, "duplicate-owner@example.com");
    const member = await register(app, "duplicate-member@example.com");
    const created = await owner.agent
      .post("/api/projects")
      .send({ name: "No duplicate members" });
    const memberPath = `/api/projects/${created.body.project.id}/members`;
    await owner.agent.post(memberPath).send({ email: "duplicate-member@example.com" });

    const duplicateMember = await owner.agent
      .post(memberPath)
      .send({ email: "duplicate-member@example.com" });
    const duplicateOwner = await owner.agent
      .post(memberPath)
      .send({ email: "duplicate-owner@example.com" });

    expect(duplicateMember.status).toBe(409);
    expect(duplicateMember.body.error.code).toBe("MEMBERSHIP_EXISTS");
    expect(duplicateOwner.status).toBe(409);
    expect(duplicateOwner.body.error.code).toBe("MEMBERSHIP_EXISTS");
    expect((await member.agent.get("/api/projects")).body.projects).toHaveLength(1);
  });

  it("rejects client-supplied roles or user IDs for membership changes", async () => {
    const { app } = setup();
    const owner = await register(app, "spoof-owner@example.com");
    await register(app, "spoof-target@example.com");
    const created = await owner.agent
      .post("/api/projects")
      .send({ name: "No spoofing" });

    const response = await owner.agent
      .post(`/api/projects/${created.body.project.id}/members`)
      .send({
        email: "spoof-target@example.com",
        userId: owner.userId,
        role: "owner",
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("VALIDATION_ERROR");
  });

  it("rejects invalid project input and malformed project IDs", async () => {
    const { app } = setup();
    const { agent } = await register(app, "validation@example.com");
    const invalidBody = await agent.post("/api/projects").send({ name: "x" });
    const extraFields = await agent
      .post("/api/projects")
      .send({ name: "Valid name", ownerId: "forged", role: "owner" });
    const invalidId = await agent.get("/api/projects/not-an-object-id");

    expect(invalidBody.status).toBe(400);
    expect(invalidBody.body.error.code).toBe("VALIDATION_ERROR");
    expect(extraFields.status).toBe(400);
    expect(extraFields.body.error.code).toBe("VALIDATION_ERROR");
    expect(invalidId.status).toBe(400);
    expect(invalidId.body.error.code).toBe("VALIDATION_ERROR");
  });
});
