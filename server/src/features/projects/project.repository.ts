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
  position: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProjectRecord {
  id: string;
  name: string;
  ownerId: string;
  members: Array<{ userId: string; role: ProjectRole }>;
  columns: ProjectColumnRecord[];
  cards: ProjectCardRecord[];
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

export interface ProjectRepository {
  create(input: NewProject): Promise<ProjectRecord>;
  listForMember(userId: string): Promise<ProjectRecord[]>;
  findById(id: string): Promise<ProjectRecord | null>;
  addMember(projectId: string, userId: string): Promise<ProjectRecord | null>;
  createColumn(projectId: string, name: string): Promise<ProjectRecord | null>;
  renameColumn(
    projectId: string,
    columnId: string,
    name: string,
  ): Promise<ProjectRecord | null>;
  reorderColumns(
    projectId: string,
    columnIds: string[],
  ): Promise<ProjectRecord | null>;
  createCard(projectId: string, input: NewCard): Promise<ProjectRecord | null>;
  updateCard(
    projectId: string,
    cardId: string,
    fields: Partial<Omit<NewCard, "columnId">>,
  ): Promise<ProjectRecord | null>;
  deleteCard(projectId: string, cardId: string): Promise<ProjectRecord | null>;
  moveCard(
    projectId: string,
    cardId: string,
    columnId: string,
    position: number,
    expectedVersion: number,
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

  async createColumn(projectId: string, name: string): Promise<ProjectRecord | null> {
    const columnId = new mongoose.Types.ObjectId();
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
  ): Promise<ProjectRecord | null> {
    const project = await ProjectModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(projectId),
        "columns._id": new mongoose.Types.ObjectId(columnId),
      },
      { $set: { "columns.$.name": name } },
      { new: true, runValidators: true },
    ).exec();
    return project ? toRecord(project) : null;
  }

  async reorderColumns(
    projectId: string,
    columnIds: string[],
  ): Promise<ProjectRecord | null> {
    const orderedIds = columnIds.map((id) => new mongoose.Types.ObjectId(id));
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
          },
        },
      ],
    ).exec();
    if (result.matchedCount === 0) return null;
    return this.findById(projectId);
  }

  async createCard(projectId: string, input: NewCard): Promise<ProjectRecord | null> {
    const cardId = new mongoose.Types.ObjectId();
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
    const project = await ProjectModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(projectId),
        "cards._id": new mongoose.Types.ObjectId(cardId),
      },
      { $set: setFields, $inc: { __v: 1 } },
      { new: true, runValidators: true },
    ).exec();
    return project ? toRecord(project) : null;
  }

  async deleteCard(projectId: string, cardId: string): Promise<ProjectRecord | null> {
    const project = await ProjectModel.findOneAndUpdate(
      {
        _id: new mongoose.Types.ObjectId(projectId),
        "cards._id": new mongoose.Types.ObjectId(cardId),
      },
      { $pull: { cards: { _id: new mongoose.Types.ObjectId(cardId) } }, $inc: { __v: 1 } },
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
  ): Promise<ProjectRecord | null> {
    const cardObjectId = new mongoose.Types.ObjectId(cardId);
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
            __v: { $add: ["$__v", 1] },
          },
        },
      ],
    ).exec();
    if (result.matchedCount === 0) return null;
    return this.findById(projectId);
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
    position: number;
    createdAt: Date;
    updatedAt: Date;
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
        position: card.position,
        createdAt: card.createdAt,
        updatedAt: card.updatedAt,
      })),
    version: project.__v ?? 0,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}
