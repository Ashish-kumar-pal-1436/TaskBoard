import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { connectToDatabase, disconnectFromDatabase } from "../src/config/database.js";
import { AuthService } from "../src/features/auth/auth.service.js";
import { MongoUserRepository } from "../src/features/auth/user.repository.js";
import { ProjectModel } from "../src/features/projects/project.model.js";
import {
  DEFAULT_PROJECT_COLUMNS,
  MongoProjectRepository,
} from "../src/features/projects/project.repository.js";
import { ProjectService } from "../src/features/projects/project.service.js";

const databaseUri = process.env.TEST_MONGODB_URI;
if (!databaseUri) {
  throw new Error("Set TEST_MONGODB_URI to a dedicated test database.");
}

const integrationSecret = "integration-only-secret-not-used-for-real-accounts";
const users = new MongoUserRepository();
const projects = new MongoProjectRepository();
const projectService = new ProjectService(projects, users);
const authService = new AuthService(users, integrationSecret, 900);
const app = createApp(
  {
    CLIENT_ORIGIN: "http://localhost:5173",
    NODE_ENV: "test",
    JWT_SECRET: integrationSecret,
    JWT_ACCESS_TOKEN_TTL_SECONDS: 900,
  },
  authService,
  projectService,
);

let projectId: string | null = null;
let ownerId: string | null = null;
const createdProjectIds: string[] = [];

describe("MongoDB project repository integration", () => {
  beforeAll(async () => {
    await connectToDatabase(databaseUri);
  }, 30_000);

  afterAll(async () => {
    try {
      for (const createdId of createdProjectIds) {
        await ProjectModel.deleteOne({
          _id: new mongoose.Types.ObjectId(createdId),
        }).exec();
      }
      if (ownerId) {
        await mongoose.model("User").deleteOne({
          _id: new mongoose.Types.ObjectId(ownerId),
        }).exec();
      }
    } finally {
      await disconnectFromDatabase();
    }
  }, 30_000);

  it("persists projects, columns, cards, comments, activities, and concurrency guards", async () => {
    const agent = request.agent(app);
    const email = `mongo-integration-${new mongoose.Types.ObjectId().toString()}@example.test`;
    const registration = await agent.post("/api/auth/register").send({
      email,
      displayName: "Mongo Integration",
      password: "Disposable-test-password-42",
    });
    expect(registration.status).toBe(201);
    ownerId = registration.body.user.id as string;

    const createProject = await agent.post("/api/projects").send({
      name: "Disposable MongoDB integration",
    });
    expect(createProject.status).toBe(201);
    projectId = createProject.body.project.id as string;
    createdProjectIds.push(projectId);
    expect((await projects.findById(projectId))?.columns.map((column) => column.name)).toEqual(
      [...DEFAULT_PROJECT_COLUMNS],
    );

    const columnsPath = `/api/projects/${projectId}/columns`;
    const addColumn = await agent.post(columnsPath).send({ name: "Review" });
    expect(addColumn.status).toBe(201);
    const reviewColumnId = addColumn.body.columns.at(-1).id as string;
    const renameColumn = await agent
      .patch(`${columnsPath}/${reviewColumnId}`)
      .send({ name: "Ready for review" });
    expect(renameColumn.status).toBe(200);
    const currentColumns = (await projects.findById(projectId))!.columns;
    const reverseOrder = [...currentColumns].reverse().map((column) => column.id);
    const rotatedOrder = [
      ...currentColumns.slice(1).map((column) => column.id),
      currentColumns[0].id,
    ];
    expect(reverseOrder).not.toEqual(rotatedOrder);

    const reorderResponses = await Promise.all([
      agent.patch(`${columnsPath}/reorder`).send({ columnIds: reverseOrder }),
      agent
        .patch(`${columnsPath}/reorder`)
        .send({ columnIds: rotatedOrder }),
    ]);
    expect(reorderResponses.every((response) => response.status === 200)).toBe(true);
    const reorderedProject = (await projects.findById(projectId))!;
    expect(reorderedProject.columns.map((column) => column.position)).toEqual(
      reorderedProject.columns.map((_, index) => index),
    );
    expect(reorderedProject.activities.map((activity) => activity.action)).toEqual(
      expect.arrayContaining(["column.created", "column.renamed", "column.reordered"]),
    );
    expect(
      reorderedProject.activities.filter((activity) => activity.action === "column.reordered"),
    ).toHaveLength(2);

    const cardsPath = `/api/projects/${projectId}/cards`;
    const sourceColumn = reorderedProject.columns.find((column) => column.name === "To Do")!;
    const destinationColumn = reorderedProject.columns.find(
      (column) => column.id === reviewColumnId,
    )!;
    const firstCreate = await agent.post(cardsPath).send({
      columnId: sourceColumn.id,
      title: "Mongo card one",
      description: "Initial description",
      labels: ["integration"],
    });
    expect(firstCreate.status).toBe(201);
    const firstCardId = firstCreate.body.cards.find(
      (card: { title: string }) => card.title === "Mongo card one",
    ).id as string;
    const secondCreate = await agent.post(cardsPath).send({
      columnId: sourceColumn.id,
      title: "Mongo card two",
    });
    expect(secondCreate.status).toBe(201);
    const secondCardId = secondCreate.body.cards.find(
      (card: { title: string }) => card.title === "Mongo card two",
    ).id as string;

    const update = await agent
      .patch(`${cardsPath}/${firstCardId}`)
      .send({ title: "Edited Mongo card", description: "Updated from API" });
    expect(update.status).toBe(200);
    const editedCard = (await projects.findById(projectId))!.cards.find(
      (card) => card.id === firstCardId,
    )!;
    expect(editedCard).toMatchObject({
      title: "Edited Mongo card",
      description: "Updated from API",
      labels: ["integration"],
    });

    const move = await agent
      .patch(`${cardsPath}/${secondCardId}/move`)
      .send({ columnId: destinationColumn.id });
    expect(move.status).toBe(200);
    let persisted = (await projects.findById(projectId))!;
    expect(persisted.cards.find((card) => card.id === secondCardId)).toMatchObject({
      columnId: destinationColumn.id,
      position: 1,
    });
    expect(
      persisted.activities.filter((activity) => activity.action === "card.moved"),
    ).toHaveLength(1);

    const commentPath = `${cardsPath}/${firstCardId}/comments`;
    const comment = await agent.post(commentPath).send({
      content: "Comment from the registered integration user",
    });
    expect(comment.status).toBe(201);
    expect(comment.body.comments[0]).toMatchObject({
      authorId: ownerId,
      content: "Comment from the registered integration user",
    });
    const listedComments = await agent.get(commentPath);
    expect(listedComments.status).toBe(200);
    expect(listedComments.body.comments[0].authorId).toBe(ownerId);
    persisted = (await projects.findById(projectId))!;
    expect(persisted.activities.some((activity) => activity.action === "comment.added")).toBe(
      true,
    );

    const beforeStaleMove = persisted.activities.length;
    const staleVersion = persisted.version;
    const staleMoveSucceeded = await projects.moveCard(
      projectId,
      firstCardId,
      destinationColumn.id,
      1.5,
      staleVersion,
      ownerId,
      editedCard.title,
      sourceColumn.name,
      destinationColumn.name,
    );
    expect(staleMoveSucceeded).not.toBeNull();
    const rejectedStaleMove = await projects.moveCard(
      projectId,
      firstCardId,
      sourceColumn.id,
      1,
      staleVersion,
      ownerId,
      editedCard.title,
      destinationColumn.name,
      sourceColumn.name,
    );
    expect(rejectedStaleMove).toBeNull();
    persisted = (await projects.findById(projectId))!;
    expect(persisted.activities).toHaveLength(beforeStaleMove + 1);
    expect(
      persisted.activities.filter(
        (activity) =>
          activity.action === "card.moved" && activity.entityId === firstCardId,
      ),
    ).toHaveLength(1);

    const concurrencyProject = await projects.create({
      name: "Concurrent move check",
      ownerId,
    });
    createdProjectIds.push(concurrencyProject.id);
    const concurrencySource = concurrencyProject.columns[0];
    const concurrencyDestination = concurrencyProject.columns[1];
    await Promise.all([
      projects.createCard(
        concurrencyProject.id,
        {
          columnId: concurrencySource.id,
          title: "Concurrent A",
          description: "",
          assigneeId: null,
          dueDate: null,
          labels: [],
        },
        ownerId,
        concurrencySource.name,
      ),
      projects.createCard(
        concurrencyProject.id,
        {
          columnId: concurrencySource.id,
          title: "Concurrent B",
          description: "",
          assigneeId: null,
          dueDate: null,
          labels: [],
        },
        ownerId,
        concurrencySource.name,
      ),
    ]);
    const concurrentState = (await projects.findById(concurrencyProject.id))!;
    const firstConcurrentCard = concurrentState.cards[0];
    const secondConcurrentCard = concurrentState.cards[1];
    const concurrentMoveResults = await Promise.all([
      projects.moveCard(
        concurrencyProject.id,
        firstConcurrentCard.id,
        concurrencyDestination.id,
        1,
        concurrentState.version,
        ownerId,
        firstConcurrentCard.title,
        concurrencySource.name,
        concurrencyDestination.name,
      ),
      projects.moveCard(
        concurrencyProject.id,
        secondConcurrentCard.id,
        concurrencyDestination.id,
        2,
        concurrentState.version,
        ownerId,
        secondConcurrentCard.title,
        concurrencySource.name,
        concurrencyDestination.name,
      ),
    ]);
    expect(concurrentMoveResults.filter(Boolean)).toHaveLength(1);
    const afterConcurrentMoves = (await projects.findById(concurrencyProject.id))!;
    expect(afterConcurrentMoves.cards.filter((card) => card.columnId === concurrencyDestination.id))
      .toHaveLength(1);
    expect(afterConcurrentMoves.activities.filter((activity) => activity.action === "card.moved"))
      .toHaveLength(1);
    await disconnectFromDatabase();
    await connectToDatabase(databaseUri);
    const afterReconnect = await projects.findById(projectId);
    expect(afterReconnect?.cards.some((card) => card.id === firstCardId)).toBe(true);
    expect(afterReconnect?.cards.find((card) => card.id === firstCardId)?.comments[0]).toMatchObject({
      authorId: ownerId,
      content: "Comment from the registered integration user",
    });
    expect(afterReconnect?.activities.some((activity) => activity.action === "comment.added")).toBe(
      true,
    );

    const deleted = await agent.delete(`${cardsPath}/${firstCardId}`);
    expect(deleted.status).toBe(204);
    expect((await projects.findById(projectId))?.cards.some((card) => card.id === firstCardId))
      .toBe(false);
  }, 120_000);
});
