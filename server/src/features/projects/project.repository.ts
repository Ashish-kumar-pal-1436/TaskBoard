import mongoose from "mongoose";
import { ProjectModel } from "./project.model.js";

export type ProjectRole = "owner" | "member";
export interface ProjectColumnRecord {
  id: string;
  name: string;
  position: number;
}

export interface ProjectCardRecord {
  id: string;
  columnId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: Date | null;
  labels: string[];
  comments: ProjectCommentRecord[];
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectCommentRecord {
  id: string;
  authorId: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ProjectActivityAction =
  | "card.created"
  | "card.updated"
  | "card.deleted"
  | "card.moved"
  | "comment.added"
  | "column.created"
  | "column.renamed"
  | "column.reordered";

export interface ProjectActivityRecord {
  id: string;
  projectId: string;
  actorId: string;
  action: ProjectActivityAction;
  entityId: string;
  metadata: {
    title?: string | null;
    name?: string | null;
    previousName?: string | null;
    fromColumn?: string | null;
    toColumn?: string | null;
  } | null;
  createdAt: Date;
}

export interface ProjectRecord {
  id: string;
  name: string;
  ownerId: string;
  members: Array<{ userId: string; role: ProjectRole }>;
  columns: ProjectColumnRecord[];
  cards: ProjectCardRecord[];
  activities: ProjectActivityRecord[];
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewProject {
  name: string;
  ownerId: string;
}

export interface NewCard {
  columnId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: Date | null;
  labels: string[];
}

export interface NewComment {
  authorId: string;
  content: string;
}

export interface ProjectRepository {
  create(input: NewProject): Promise<ProjectRecord>;
  listForMember(userId: string): Promise<ProjectRecord[]>;
  findById(id: string): Promise<ProjectRecord | null>;
  addMember(projectId: string, userId: string): Promise<ProjectRecord | null>;
  createColumn(projectId: string, name: string, actorId: string): Promise<ProjectRecord | null>;
  renameColumn(
    projectId: string,
    columnId: string,
    name: string,
    actorId: string,
    previousName: string,
  ): Promise<ProjectRecord | null>;
  reorderColumns(
    projectId: string,
    columnIds: string[],
    actorId: string,
  ): Promise<ProjectRecord | null>;
  createCard(
    projectId: string,
    input: NewCard,
    actorId: string,
    columnName: string,
  ): Promise<ProjectRecord | null>;
  updateCard(
    projectId: string,
    cardId: string,
    fields: Partial<Omit<NewCard, "columnId">>,
    actorId: string,
    activityTitle: string,
  ): Promise<ProjectRecord | null>;
  deleteCard(
    projectId: string,
    cardId: string,
    actorId: string,
    title: string,
  ): Promise<ProjectRecord | null>;
  moveCard(
    projectId: string,
    cardId: string,
    columnId: string,
    position: number,
    expectedVersion: number,
    actorId: string,
    title: string,
    fromColumn: string,
    toColumn: string,
  ): Promise<ProjectRecord | null>;
  addComment(
    projectId: string,
    cardId: string,
    input: NewComment,
    cardTitle: string,
  ): Promise<ProjectRecord | null>;
}

export const DEFAULT_PROJECT_COLUMNS = ["To Do", "In Progress", "Done"] as const;

export class MongoProjectRepository implements ProjectRepository {
  async create(input: NewProject): Promise<ProjectRecord> {
    const project = await ProjectModel.create({
      name: input.name,
      ownerId: new mongoose.Types.ObjectId(input.ownerId),
      members: [{ userId: new mongoose.Types.ObjectId(input.ownerId), role: "owner" }],
      columns: DEFAULT_PROJECT_COLUMNS.map((name, position) => ({ name, position })),
    });
    return toRecord(project);
  }

  async listForMember(userId: string): Promise<ProjectRecord[]> {
    const projects = await ProjectModel.find({
      "members.userId": new mongoose.Types.ObjectId(userId),
    })
      .sort({ createdAt: -1, _id: 1 })
      .exec();
    return projects.map(toRecord);
  }

  async findById(id: string): Promise<ProjectRecord | null> {
    const project = await ProjectModel.findById(id).exec();
    return project ? toRecord(project) : null;
  }

  async addMember(projectId: string, userId: string): Promise<ProjectRecord | null> {
    const project = await ProjectModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(projectId),
        "members.userId": { $ne: new mongoose.Types.ObjectId(userId) },
      },
      {
        $push: {
          members: { userId: new mongoose.Types.ObjectId(userId), role: "member" },
        },
      },
      { new: true, runValidators: true },
    ).exec();
    return project ? toRecord(project) : null;
  }

  async createColumn(
    projectId: string,
    name: string,
    actorId: string,
  ): Promise<ProjectRecord | null> {
    const columnId = new mongoose.Types.ObjectId();
    const activity = createActivity(projectId, actorId, "column.created", columnId.toString(), { name });
    const result = await ProjectModel.updateOne(
      { _id: new mongoose.Types.ObjectId(projectId) },
      [
        {
          $set: {
            columns: {
              $concatArrays: [
                { $ifNull: ["$columns", []] },
                [
                  {
                    _id: columnId,
                    name,
                    position: { $size: { $ifNull: ["$columns", []] } },
                  },
                ],
              ],
            },
            activities: appendActivity("$activities", activity),
          },
        },
      ],
    ).exec();
    if (result.matchedCount === 0) return null;
    return this.findById(projectId);
  }

  async renameColumn(
    projectId: string,
    columnId: string,
    name: string,
    actorId: string,
    previousName: string,
  ): Promise<ProjectRecord | null> {
    const activity = createActivity(projectId, actorId, "column.renamed", columnId, {
      name,
      previousName,
    });
    const project = await ProjectModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(projectId),
        "columns._id": new mongoose.Types.ObjectId(columnId),
      },
      {
        $set: { "columns.$.name": name },
        $push: { activities: { $each: [activity], $slice: -500 } },
      },
      { new: true, runValidators: true },
    ).exec();
    return project ? toRecord(project) : null;
  }

  async reorderColumns(
    projectId: string,
    columnIds: string[],
    actorId: string,
  ): Promise<ProjectRecord | null> {
    const orderedIds = columnIds.map((id) => new mongoose.Types.ObjectId(id));
    const activity = createActivity(projectId, actorId, "column.reordered", projectId, {});
    const result = await ProjectModel.updateOne(
      {
        _id: new mongoose.Types.ObjectId(projectId),
        $expr: {
          $and: [
            { $eq: [{ $size: { $ifNull: ["$columns", []] } }, orderedIds.length] },
            {
              $setEquals: [
                {
                  $map: {
                    input: { $ifNull: ["$columns", []] },
                    as: "column",
                    in: "$$column._id",
                  },
                },
                orderedIds,
              ],
            },
          ],
        },
      },
      [
        {
          $set: {
            columns: {
              $map: {
                input: "$columns",
                as: "column",
                in: {
                  $mergeObjects: [
                    "$$column",
                    { position: { $indexOfArray: [orderedIds, "$$column._id"] } },
                  ],
                },
              },
            },
            activities: appendActivity("$activities", activity),
          },
        },
      ],
    ).exec();
    if (result.matchedCount === 0) return null;
    return this.findById(projectId);
  }

  async createCard(
    projectId: string,
    input: NewCard,
    actorId: string,
    columnName: string,
  ): Promise<ProjectRecord | null> {
    const cardId = new mongoose.Types.ObjectId();
    const activity = createActivity(projectId, actorId, "card.created", cardId.toString(), {
      title: input.title,
      toColumn: columnName,
    });
    const card = {
      _id: cardId,
      columnId: new mongoose.Types.ObjectId(input.columnId),
      title: input.title,
      description: input.description,
      assigneeId: input.assigneeId
        ? new mongoose.Types.ObjectId(input.assigneeId)
        : null,
      dueDate: input.dueDate,
      labels: input.labels,
      comments: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const result = await ProjectModel.updateOne(
      { _id: new mongoose.Types.ObjectId(projectId) },
      [
        {
          $set: {
            cards: {
              $concatArrays: [
                { $ifNull: ["$cards", []] },
                [
                  {
                    ...card,
                    position: {
                      $add: [
                        {
                          $ifNull: [
                            {
                              $max: {
                                $map: {
                                  input: {
                                    $filter: {
                                      input: { $ifNull: ["$cards", []] },
                                      as: "existing",
                                      cond: {
                                        $eq: [
                                          "$$existing.columnId",
                                          new mongoose.Types.ObjectId(input.columnId),
                                        ],
                                      },
                                    },
                                  },
                                  as: "existing",
                                  in: "$$existing.position",
                                },
                              },
                            },
                            0,
                          ],
                        },
                        1,
                      ],
                    },
                  },
                ],
              ],
            },
            activities: appendActivity("$activities", activity),
            __v: { $add: [{ $ifNull: ["$__v", 0] }, 1] },
          },
        },
      ],
    ).exec();
    if (result.matchedCount === 0) return null;
    return this.findById(projectId);
  }

  async updateCard(
    projectId: string,
    cardId: string,
    fields: Partial<Omit<NewCard, "columnId">>,
    actorId: string,
    activityTitle: string,
  ): Promise<ProjectRecord | null> {
    const setFields: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(fields)) {
      if (field === "assigneeId" && typeof value === "string") {
        setFields[`cards.$.${field}`] = new mongoose.Types.ObjectId(value);
      } else {
        setFields[`cards.$.${field}`] = value;
      }
    }
    setFields["cards.$.updatedAt"] = new Date();
    const activity = createActivity(projectId, actorId, "card.updated", cardId, {
      title: activityTitle,
    });
    const project = await ProjectModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(projectId),
        "cards._id": new mongoose.Types.ObjectId(cardId),
      },
      {
        $set: setFields,
        $push: { activities: { $each: [activity], $slice: -500 } },
        $inc: { __v: 1 },
      },
      { new: true, runValidators: true },
    ).exec();
    return project ? toRecord(project) : null;
  }

  async deleteCard(
    projectId: string,
    cardId: string,
    actorId: string,
    title: string,
  ): Promise<ProjectRecord | null> {
    const activity = createActivity(projectId, actorId, "card.deleted", cardId, { title });
    const project = await ProjectModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(projectId),
        "cards._id": new mongoose.Types.ObjectId(cardId),
      },
      {
        $pull: { cards: { _id: new mongoose.Types.ObjectId(cardId) } },
        $push: { activities: { $each: [activity], $slice: -500 } },
        $inc: { __v: 1 },
      },
      { new: true },
    ).exec();
    return project ? toRecord(project) : null;
  }

  async moveCard(
    projectId: string,
    cardId: string,
    columnId: string,
    position: number,
    expectedVersion: number,
    actorId: string,
    title: string,
    fromColumn: string,
    toColumn: string,
  ): Promise<ProjectRecord | null> {
    const cardObjectId = new mongoose.Types.ObjectId(cardId);
    const activity = createActivity(projectId, actorId, "card.moved", cardId, {
      title,
      fromColumn,
      toColumn,
    });
    const result = await ProjectModel.updateOne(
      {
        _id: new mongoose.Types.ObjectId(projectId),
        __v: expectedVersion,
        "cards._id": cardObjectId,
      },
      [
        {
          $set: {
            cards: {
              $map: {
                input: "$cards",
                as: "card",
                in: {
                  $cond: [
                    { $eq: ["$$card._id", cardObjectId] },
                    {
                      $mergeObjects: [
                        "$$card",
                        {
                          columnId: new mongoose.Types.ObjectId(columnId),
                          position,
                          updatedAt: new Date(),
                        },
                      ],
                    },
                    "$$card",
                  ],
                },
              },
            },
            activities: appendActivity("$activities", activity),
            __v: { $add: ["$__v", 1] },
          },
        },
      ],
    ).exec();
    if (result.matchedCount === 0) return null;
    return this.findById(projectId);
  }

  async addComment(
    projectId: string,
    cardId: string,
    input: NewComment,
    cardTitle: string,
  ): Promise<ProjectRecord | null> {
    const commentId = new mongoose.Types.ObjectId();
    const now = new Date();
    const activity = createActivity(
      projectId,
      input.authorId,
      "comment.added",
      commentId.toString(),
      { title: cardTitle },
    );
    const project = await ProjectModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(projectId),
        "cards._id": new mongoose.Types.ObjectId(cardId),
      },
      {
        $push: {
          "cards.$.comments": {
            _id: commentId,
            authorId: new mongoose.Types.ObjectId(input.authorId),
            content: input.content,
            createdAt: now,
            updatedAt: now,
          },
          activities: { $each: [activity], $slice: -500 },
        },
        $inc: { __v: 1 },
      },
      { new: true, runValidators: true },
    ).exec();
    return project ? toRecord(project) : null;
  }
}

function toRecord(project: {
  _id: { toString(): string };
  name: string;
  ownerId: { toString(): string };
  members: Array<{ userId: { toString(): string }; role: ProjectRole }>;
  columns?: Array<{
    _id: { toString(): string };
    name: string;
    position: number;
  }>;
  cards?: Array<{
    _id: { toString(): string };
    columnId: { toString(): string };
    title: string;
    description?: string;
    assigneeId?: { toString(): string } | null;
    dueDate?: Date | null;
    labels?: string[];
    comments?: Array<{
      _id: { toString(): string };
      authorId: { toString(): string };
      content: string;
      createdAt: Date;
      updatedAt: Date;
    }>;
    position: number;
    createdAt: Date;
    updatedAt: Date;
  }>;
  activities?: Array<{
    _id: { toString(): string };
    projectId: { toString(): string };
    actorId: { toString(): string };
    action: ProjectActivityAction;
    entityId: { toString(): string };
    metadata?: ProjectActivityRecord["metadata"];
    createdAt: Date;
  }>;
  __v?: number;
  createdAt: Date;
  updatedAt: Date;
}): ProjectRecord {
  return {
    id: project._id.toString(),
    name: project.name,
    ownerId: project.ownerId.toString(),
    members: project.members.map((member) => ({
      userId: member.userId.toString(),
      role: member.role,
    })),
    columns: [...(project.columns ?? [])]
      .sort((left, right) => left.position - right.position)
      .map((column) => ({
        id: column._id.toString(),
        name: column.name,
        position: column.position,
      })),
    cards: [...(project.cards ?? [])]
      .sort((left, right) => left.position - right.position)
      .map((card) => ({
        id: card._id.toString(),
        columnId: card.columnId.toString(),
        title: card.title,
        description: card.description ?? "",
        assigneeId: card.assigneeId?.toString() ?? null,
        dueDate: card.dueDate ?? null,
        labels: card.labels ?? [],
        comments: (card.comments ?? []).map((comment) => ({
          id: comment._id.toString(),
          authorId: comment.authorId.toString(),
          content: comment.content,
          createdAt: comment.createdAt,
          updatedAt: comment.updatedAt,
        })),
        position: card.position,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      })),
    activities: (project.activities ?? []).map((activity) => ({
      id: activity._id.toString(),
      projectId: activity.projectId.toString(),
      actorId: activity.actorId.toString(),
      action: activity.action,
      entityId: activity.entityId.toString(),
      metadata: activity.metadata ?? {},
      createdAt: activity.createdAt,
    })),
    version: project.__v ?? 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function createActivity(
  projectId: string,
  actorId: string,
  action: ProjectActivityAction,
  entityId: string,
  metadata: ProjectActivityRecord["metadata"],
) {
  return {
    _id: new mongoose.Types.ObjectId(),
    projectId: new mongoose.Types.ObjectId(projectId),
    actorId: new mongoose.Types.ObjectId(actorId),
    action,
    entityId: new mongoose.Types.ObjectId(entityId),
    metadata,
    createdAt: new Date(),
  };
}

function appendActivity(path: string, activity: ReturnType<typeof createActivity>) {
  return {
    $slice: [
      { $concatArrays: [{ $ifNull: [path, []] }, [activity]] },
      -500,
    ],
  };
}
