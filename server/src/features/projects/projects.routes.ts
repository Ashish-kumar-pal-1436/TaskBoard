import { Router } from "express";
import type { AuthService, PublicUser } from "../auth/auth.service.js";
import { requireAuthenticatedUser } from "../auth/auth.routes.js";
import {
  addProjectMemberSchema,
  cardParamsSchema,
  commentSchema,
  createProjectSchema,
  createCardSchema,
  moveCardSchema,
  projectColumnParamsSchema,
  projectIdSchema,
  renameColumnSchema,
  reorderColumnsSchema,
  updateCardSchema,
} from "./project.validation.js";
import { ProjectService } from "./project.service.js";
import { AppError } from "../../middleware/app-error.js";

export function createProjectsRouter(auth: AuthService, projects: ProjectService) {
  const router = Router();

  router.use(requireAuthenticatedUser(auth));

  router.post("/", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const input = createProjectSchema.parse(request.body);
    const project = await projects.create(input, user.id);
    response.status(201).json({ project });
  });

  router.get("/", async (_request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const projectsForUser = await projects.listForMember(user.id);
    response.status(200).json({ projects: projectsForUser });
  });

  router.get("/:projectId", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const { projectId } = projectIdSchema.parse(request.params);
    const project = await projects.getForMember(projectId, user.id);
    response.status(200).json({ project });
  });

  router.post("/:projectId/members", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const { projectId } = projectIdSchema.parse(request.params);
    const input = addProjectMemberSchema.parse(request.body);
    const project = await projects.addMember(projectId, user.id, input);
    response.status(201).json({ project });
  });

  router.get("/:projectId/columns", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const { projectId } = projectIdSchema.parse(request.params);
    const columns = await projects.listColumns(projectId, user.id);
    response.status(200).json({ columns });
  });

  router.post("/:projectId/columns", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const { projectId } = projectIdSchema.parse(request.params);
    const { name } = renameColumnSchema.parse(request.body);
    const columns = await projects.createColumn(projectId, user.id, name);
    response.status(201).json({ columns });
  });

  router.patch("/:projectId/columns/reorder", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const { projectId } = projectIdSchema.parse(request.params);
    const input = reorderColumnsSchema.parse(request.body);
    const columns = await projects.reorderColumns(projectId, user.id, input);
    response.status(200).json({ columns });
  });

  router.patch("/:projectId/columns/:columnId", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const { projectId, columnId } = projectColumnParamsSchema.parse(request.params);
    const input = renameColumnSchema.parse(request.body);
    const columns = await projects.renameColumn(projectId, columnId, user.id, input);
    response.status(200).json({ columns });
  });

  router.get("/:projectId/activity", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const { projectId } = projectIdSchema.parse(request.params);
    const activities = await projects.listActivity(projectId, user.id);
    response.status(200).json({ activities });
  });

  router.get("/:projectId/cards", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const { projectId } = projectIdSchema.parse(request.params);
    const cards = await projects.listCards(projectId, user.id);
    response.status(200).json({ cards });
  });

  router.post("/:projectId/cards", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const { projectId } = projectIdSchema.parse(request.params);
    const input = createCardSchema.parse(request.body);
    const cards = await projects.createCard(projectId, user.id, input);
    response.status(201).json({ cards });
  });

  router.patch("/:projectId/cards/:cardId/move", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const { projectId, cardId } = cardParamsSchema.parse(request.params);
    const input = moveCardSchema.parse(request.body);
    const cards = await projects.moveCard(projectId, cardId, user.id, input);
    response.status(200).json({ cards });
  });

  router.patch("/:projectId/cards/:cardId", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const { projectId, cardId } = cardParamsSchema.parse(request.params);
    const input = updateCardSchema.parse(request.body);
    const cards = await projects.updateCard(projectId, cardId, user.id, input);
    response.status(200).json({ cards });
  });

  router.delete("/:projectId/cards/:cardId", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const { projectId, cardId } = cardParamsSchema.parse(request.params);
    await projects.deleteCard(projectId, cardId, user.id);
    response.status(204).end();
  });

  router.get("/:projectId/cards/:cardId/comments", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const { projectId, cardId } = cardParamsSchema.parse(request.params);
    const comments = await projects.listComments(projectId, cardId, user.id);
    response.status(200).json({ comments });
  });

  router.post("/:projectId/cards/:cardId/comments", async (request, response) => {
    const user = getAuthenticatedUser(response.locals.authUser);
    const { projectId, cardId } = cardParamsSchema.parse(request.params);
    const input = commentSchema.parse(request.body);
    const comments = await projects.addComment(projectId, cardId, user.id, input);
    response.status(201).json({ comments });
  });

  return router;
}

function getAuthenticatedUser(value: unknown): PublicUser {
  if (
    typeof value !== "object" ||
    value === null ||
    !("id" in value) ||
    typeof value.id !== "string" ||
    !("email" in value) ||
    typeof value.email !== "string" ||
    !("displayName" in value) ||
    typeof value.displayName !== "string"
  ) {
    throw new AppError(401, "UNAUTHENTICATED", "Sign in to continue.");
  }
  return {
    id: value.id,
    email: value.email,
    displayName: value.displayName,
  };
}
