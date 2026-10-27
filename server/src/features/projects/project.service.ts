import { AppError } from "../../middleware/app-error.js";
import type { UserRepository } from "../auth/user.repository.js";
import type {
  AddProjectMemberInput,
  CreateCardInput,
  CreateProjectInput,
  MoveCardInput,
  UpdateCardInput,
} from "./project.validation.js";
import type {
  ProjectCardRecord,
  ProjectColumnRecord,
  ProjectRecord,
  ProjectRepository,
} from "./project.repository.js";
import type { RenameColumnInput, ReorderColumnsInput } from "./project.validation.js";

export interface ProjectResponse {
  id: string;
  name: string;
  ownerId: string;
  role: "owner" | "member";
  createdAt: Date;
  updatedAt: Date;
}

export interface ColumnResponse {
  id: string;
  name: string;
  position: number;
}

export type CardResponse = ProjectCardRecord;

export class ProjectService {
  constructor(
    private readonly projects: ProjectRepository,
    private readonly users: UserRepository,
  ) {}

  async create(input: CreateProjectInput, userId: string): Promise<ProjectResponse> {
    const project = await this.projects.create({ name: input.name, ownerId: userId });
    return toResponse(project, userId);
  }

  async listForMember(userId: string): Promise<ProjectResponse[]> {
    const projects = await this.projects.listForMember(userId);
    return projects.map((project) => toResponse(project, userId));
  }

  async getForMember(projectId: string, userId: string): Promise<ProjectResponse> {
    const project = await this.projects.findById(projectId);
    const membership = project?.members.find((member) => member.userId === userId);
    if (!project || !membership) {
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
    }
    return toResponse(project, userId);
  }

  async addMember(
    projectId: string,
    actorId: string,
    input: AddProjectMemberInput,
  ): Promise<ProjectResponse> {
    const project = await this.projects.findById(projectId);
    if (!project || project.ownerId !== actorId) {
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
    }

    const user = await this.users.findByEmail(input.email);
    if (!user) {
      throw new AppError(404, "USER_NOT_FOUND", "No registered user has that email.");
    }

    if (project.members.some((member) => member.userId === user.id)) {
      throw new AppError(409, "MEMBERSHIP_EXISTS", "That user is already a project member.");
    }

    const updatedProject = await this.projects.addMember(projectId, user.id);
    if (!updatedProject) {
      const currentProject = await this.projects.findById(projectId);
      if (!currentProject || currentProject.ownerId !== actorId) {
        throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
      }
      if (currentProject.members.some((member) => member.userId === user.id)) {
        throw new AppError(409, "MEMBERSHIP_EXISTS", "That user is already a project member.");
      }
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
    }

    return toResponse(updatedProject, user.id);
  }

  async listColumns(projectId: string, userId: string): Promise<ColumnResponse[]> {
    const project = await this.requireMemberProject(projectId, userId);
    return toColumnResponses(project.columns);
  }

  async createColumn(
    projectId: string,
    userId: string,
    name: string,
  ): Promise<ColumnResponse[]> {
    await this.requireOwnerProject(projectId, userId);
    const updatedProject = await this.projects.createColumn(projectId, name);
    if (!updatedProject) {
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
    }
    return toColumnResponses(updatedProject.columns);
  }

  async renameColumn(
    projectId: string,
    columnId: string,
    userId: string,
    input: RenameColumnInput,
  ): Promise<ColumnResponse[]> {
    await this.requireOwnerProject(projectId, userId);
    const updatedProject = await this.projects.renameColumn(
      projectId,
      columnId,
      input.name,
    );
    if (!updatedProject) {
      throw new AppError(404, "COLUMN_NOT_FOUND", "Column not found.");
    }
    return toColumnResponses(updatedProject.columns);
  }

  async reorderColumns(
    projectId: string,
    userId: string,
    input: ReorderColumnsInput,
  ): Promise<ColumnResponse[]> {
    const project = await this.requireOwnerProject(projectId, userId);
    const existingIds = project.columns.map((column) => column.id.toLowerCase());
    const requestedIds = input.columnIds.map((id) => id.toLowerCase());
    if (
      existingIds.length !== requestedIds.length ||
      existingIds.some((id) => !requestedIds.includes(id))
    ) {
      throw new AppError(
        400,
        "INVALID_COLUMN_ORDER",
        "Reorder must include every project column exactly once.",
      );
    }

    const updatedProject = await this.projects.reorderColumns(projectId, input.columnIds);
    if (!updatedProject) {
      throw new AppError(
        400,
        "INVALID_COLUMN_ORDER",
        "Reorder must include every project column exactly once.",
      );
    }
    return toColumnResponses(updatedProject.columns);
  }

  async listCards(projectId: string, userId: string): Promise<CardResponse[]> {
    const project = await this.requireMemberProject(projectId, userId);
    return toCardResponses(project.cards);
  }

  async createCard(
    projectId: string,
    userId: string,
    input: CreateCardInput,
  ): Promise<CardResponse[]> {
    const project = await this.requireMemberProject(projectId, userId);
    this.requireColumn(project, input.columnId);
    await this.requireAssignee(project, input.assigneeId);
    const updatedProject = await this.projects.createCard(projectId, input);
    if (!updatedProject) {
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
    }
    return toCardResponses(updatedProject.cards);
  }

  async updateCard(
    projectId: string,
    cardId: string,
    userId: string,
    input: UpdateCardInput,
  ): Promise<CardResponse[]> {
    const project = await this.requireMemberProject(projectId, userId);
    if (!project.cards.some((card) => card.id === cardId)) {
      throw new AppError(404, "CARD_NOT_FOUND", "Card not found.");
    }
    if (input.assigneeId !== undefined) {
      await this.requireAssignee(project, input.assigneeId);
    }
    const updatedProject = await this.projects.updateCard(projectId, cardId, input);
    if (!updatedProject) {
      throw new AppError(404, "CARD_NOT_FOUND", "Card not found.");
    }
    return toCardResponses(updatedProject.cards);
  }

  async deleteCard(
    projectId: string,
    cardId: string,
    userId: string,
  ): Promise<void> {
    const project = await this.requireMemberProject(projectId, userId);
    if (!project.cards.some((card) => card.id === cardId)) {
      throw new AppError(404, "CARD_NOT_FOUND", "Card not found.");
    }
    const updatedProject = await this.projects.deleteCard(projectId, cardId);
    if (!updatedProject) {
      throw new AppError(404, "CARD_NOT_FOUND", "Card not found.");
    }
  }

  async moveCard(
    projectId: string,
    cardId: string,
    userId: string,
    input: MoveCardInput,
  ): Promise<CardResponse[]> {
    const project = await this.requireMemberProject(projectId, userId);
    const card = project.cards.find((item) => item.id === cardId);
    if (!card) throw new AppError(404, "CARD_NOT_FOUND", "Card not found.");
    this.requireColumn(project, input.columnId);

    const destinationCards = project.cards
      .filter((item) => item.columnId === input.columnId && item.id !== cardId)
      .sort((left, right) => left.position - right.position);
    let insertBeforeIndex = destinationCards.length;
    if (input.beforeCardId) {
      insertBeforeIndex = destinationCards.findIndex(
        (item) => item.id === input.beforeCardId,
      );
      if (insertBeforeIndex < 0) {
        throw new AppError(
          400,
          "INVALID_MOVE_ANCHOR",
          "The card to insert before must belong to the destination column.",
        );
      }
    }

    const leftPosition =
      insertBeforeIndex > 0 ? destinationCards[insertBeforeIndex - 1].position : 0;
    const rightPosition = destinationCards[insertBeforeIndex]?.position;
    const position =
      rightPosition === undefined
        ? leftPosition + 1
        : (leftPosition + rightPosition) / 2;
    if (
      !Number.isFinite(position) ||
      position <= leftPosition ||
      (rightPosition !== undefined && position >= rightPosition)
    ) {
      throw new AppError(
        409,
        "POSITION_PRECISION_EXHAUSTED",
        "Card ordering precision is exhausted at this position.",
      );
    }

    const updatedProject = await this.projects.moveCard(
      projectId,
      cardId,
      input.columnId,
      position,
      project.version,
    );
    if (!updatedProject) {
      throw new AppError(
        409,
        "BOARD_CHANGED",
        "The board changed during the move. Reload and try again.",
      );
    }
    return toCardResponses(updatedProject.cards);
  }

  private async requireMemberProject(
    projectId: string,
    userId: string,
  ): Promise<ProjectRecord> {
    const project = await this.projects.findById(projectId);
    if (!project || !project.members.some((member) => member.userId === userId)) {
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
    }
    return project;
  }

  private async requireOwnerProject(
    projectId: string,
    userId: string,
  ): Promise<ProjectRecord> {
    const project = await this.requireMemberProject(projectId, userId);
    if (project.ownerId !== userId) {
      throw new AppError(403, "OWNER_REQUIRED", "Only the project owner can manage columns.");
    }
    return project;
  }

  private requireColumn(project: ProjectRecord, columnId: string): void {
    if (!project.columns.some((column) => column.id === columnId)) {
      throw new AppError(404, "COLUMN_NOT_FOUND", "Column not found in this project.");
    }
  }

  private async requireAssignee(
    project: ProjectRecord,
    assigneeId: string | null | undefined,
  ): Promise<void> {
    if (assigneeId && !project.members.some((member) => member.userId === assigneeId)) {
      throw new AppError(400, "INVALID_ASSIGNEE", "Assignee must be a project member.");
    }
  }
}

function toResponse(project: ProjectRecord, userId: string): ProjectResponse {
  const membership = project.members.find((member) => member.userId === userId);
  if (!membership) {
    throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found.");
  }

  return {
    id: project.id,
    name: project.name,
    ownerId: project.ownerId,
    role: membership.role,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
}

function toColumnResponses(columns: ProjectColumnRecord[]): ColumnResponse[] {
  return [...columns]
    .sort((left, right) => left.position - right.position)
    .map(({ id, name, position }) => ({ id, name, position }));
}

function toCardResponses(cards: ProjectCardRecord[]): CardResponse[] {
  return [...cards]
    .sort((left, right) =>
      left.columnId === right.columnId
        ? left.position - right.position
        : left.columnId.localeCompare(right.columnId),
    )
    .map((card) => ({ ...card, labels: [...card.labels] }));
}
