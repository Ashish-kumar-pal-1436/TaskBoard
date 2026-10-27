import { useEffect, useState } from "react";
import {
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router-dom";
import { AuthPage, LoadingScreen } from "./auth/AuthPage";
import { AuthProvider } from "./auth/AuthContext";
import { useAuth } from "./auth/auth-context";

interface Project {
  id: string;
  name: string;
  role: "owner" | "member";
}

interface BoardColumn {
  id: string;
  name: string;
  position: number;
}

interface BoardCard {
  id: string;
  columnId: string;
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: string | null;
  labels: string[];
  position: number;
}

interface CardFields {
  title: string;
  description: string;
  assigneeId: string | null;
  dueDate: string | null;
  labels: string[];
}

interface BoardComment {
  id: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
}

interface BoardActivity {
  id: string;
  projectId: string;
  actorId: string;
  actorName: string;
  action:
    | "card.created"
    | "card.updated"
    | "card.deleted"
    | "card.moved"
    | "comment.added"
    | "column.created"
    | "column.renamed"
    | "column.reordered";
  entityId: string;
  metadata: {
    title?: string | null;
    name?: string | null;
    previousName?: string | null;
    fromColumn?: string | null;
    toColumn?: string | null;
  } | null;
  createdAt: string;
}

async function requestApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: string } }
      | null;
    throw new Error(body?.error?.message ?? "The request could not be completed.");
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/register" element={<AuthPage mode="register" />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <WorkspaceHome />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function WorkspaceHome() {
  const { user, logout } = useAuth();
  const currentUserId = user?.id ?? "";
  const navigate = useNavigate();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [columns, setColumns] = useState<BoardColumn[]>([]);
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [activities, setActivities] = useState<BoardActivity[]>([]);
  const [projectName, setProjectName] = useState("");
  const [columnName, setColumnName] = useState("");
  const [createCardColumnId, setCreateCardColumnId] = useState<string | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [activityLoading, setActivityLoading] = useState(true);
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingColumn, setCreatingColumn] = useState(false);
  const [movingCard, setMovingCard] = useState(false);
  const [draggedCardId, setDraggedCardId] = useState<string | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    requestApi<{ projects: Project[] }>("/api/projects")
      .then(({ projects: loadedProjects }) => {
        if (!active) return;
        const firstProjectId = loadedProjects[0]?.id ?? "";
        setProjects(loadedProjects);
        setSelectedProjectId(firstProjectId);
        setColumnsLoading(Boolean(firstProjectId));
        setActivityLoading(Boolean(firstProjectId));
      })
      .catch((error: unknown) => {
        if (active) {
          setBoardError(
            error instanceof Error ? error.message : "Could not load projects.",
          );
        }
      })
      .finally(() => {
        if (active) setProjectsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;

    let active = true;
    Promise.all([
      requestApi<{ columns: BoardColumn[] }>(
        `/api/projects/${selectedProjectId}/columns`,
      ),
      requestApi<{ cards: BoardCard[] }>(
        `/api/projects/${selectedProjectId}/cards`,
      ),
    ])
      .then(([{ columns: loadedColumns }, { cards: loadedCards }]) => {
        if (active) {
          setColumns(loadedColumns);
          setCards(loadedCards);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setBoardError(
            error instanceof Error ? error.message : "Could not load the board.",
          );
        }
      })
      .finally(() => {
        if (active) setColumnsLoading(false);
      });
    requestApi<{ activities: BoardActivity[] }>(
      `/api/projects/${selectedProjectId}/activity`,
    )
      .then(({ activities: loadedActivities }) => {
        if (active) setActivities(loadedActivities);
      })
      .catch((error: unknown) => {
        if (active) {
          setBoardError(
            error instanceof Error ? error.message : "Could not load activity.",
          );
        }
      })
      .finally(() => {
        if (active) setActivityLoading(false);
      });

    return () => {
      active = false;
    };
  }, [selectedProjectId]);

  async function reloadActivity() {
    if (!selectedProjectId) return;
    setActivityLoading(true);
    try {
      const { activities: latest } = await requestApi<{
        activities: BoardActivity[];
      }>(`/api/projects/${selectedProjectId}/activity`);
      setActivities(latest);
    } catch (error) {
      setBoardError(
        error instanceof Error ? error.message : "Could not refresh activity.",
      );
    } finally {
      setActivityLoading(false);
    }
  }

  async function handleCreateProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = projectName.trim();
    if (name.length < 2 || name.length > 80) {
      setBoardError("Project name must be between 2 and 80 characters.");
      return;
    }
    setBoardError(null);
    setCreatingProject(true);
    try {
      const { project } = await requestApi<{ project: Project }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setProjects((current) => [...current, project]);
      setSelectedProjectId(project.id);
      setColumns([]);
      setCards([]);
      setActivities([]);
      setColumnsLoading(true);
      setActivityLoading(true);
      setProjectName("");
    } catch (error) {
      setBoardError(
        error instanceof Error ? error.message : "Could not create project.",
      );
    } finally {
      setCreatingProject(false);
    }
  }

  async function handleCreateCard(columnId: string, fields: CardFields) {
    if (!selectedProjectId) return;
    setBoardError(null);
    try {
      const { cards: updatedCards } = await requestApi<{ cards: BoardCard[] }>(
        `/api/projects/${selectedProjectId}/cards`,
        {
          method: "POST",
          body: JSON.stringify({ ...fields, columnId }),
        },
      );
      setCards(updatedCards);
      setCreateCardColumnId(null);
      void reloadActivity();
    } catch (error) {
      setBoardError(
        error instanceof Error ? error.message : "Could not create the card.",
      );
    }
  }

  async function handleUpdateCard(cardId: string, fields: CardFields) {
    if (!selectedProjectId) return;
    setBoardError(null);
    try {
      const { cards: updatedCards } = await requestApi<{ cards: BoardCard[] }>(
        `/api/projects/${selectedProjectId}/cards/${cardId}`,
        { method: "PATCH", body: JSON.stringify(fields) },
      );
      setCards(updatedCards);
      void reloadActivity();
    } catch (error) {
      setBoardError(
        error instanceof Error ? error.message : "Could not update the card.",
      );
    }
  }

  async function handleDeleteCard(cardId: string) {
    if (!selectedProjectId) return;
    setBoardError(null);
    try {
      await requestApi<void>(`/api/projects/${selectedProjectId}/cards/${cardId}`, {
        method: "DELETE",
      });
      setCards((current) => current.filter((card) => card.id !== cardId));
      void reloadActivity();
    } catch (error) {
      setBoardError(
        error instanceof Error ? error.message : "Could not delete the card.",
      );
    }
  }

  async function handleMoveCard(
    cardId: string,
    columnId: string,
    beforeCardId?: string,
  ) {
    if (!selectedProjectId || movingCard) return;
    setBoardError(null);
    setMovingCard(true);
    try {
      const { cards: updatedCards } = await requestApi<{ cards: BoardCard[] }>(
        `/api/projects/${selectedProjectId}/cards/${cardId}/move`,
        {
          method: "PATCH",
          body: JSON.stringify({
            columnId,
            ...(beforeCardId ? { beforeCardId } : {}),
          }),
        },
      );
      setCards(updatedCards);
      void reloadActivity();
    } catch (error) {
      setBoardError(
        error instanceof Error ? error.message : "Could not move the card.",
      );
    } finally {
      setMovingCard(false);
      setDraggedCardId(null);
    }
  }

  async function handleCreateColumn(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = columnName.trim();
    if (!selectedProjectId || name.length < 1 || name.length > 50) {
      setBoardError("Column name must be between 1 and 50 characters.");
      return;
    }
    setBoardError(null);
    setCreatingColumn(true);
    try {
      const { columns: updatedColumns } = await requestApi<{
        columns: BoardColumn[];
      }>(`/api/projects/${selectedProjectId}/columns`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      setColumns(updatedColumns);
      setColumnName("");
      void reloadActivity();
    } catch (error) {
      setBoardError(
        error instanceof Error ? error.message : "Could not create column.",
      );
    } finally {
      setCreatingColumn(false);
    }
  }

  async function moveColumn(columnId: string, direction: -1 | 1) {
    if (!selectedProjectId) return;
    const currentIndex = columns.findIndex((column) => column.id === columnId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= columns.length) return;
    const reordered = [...columns];
    [reordered[currentIndex], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[currentIndex],
    ];
    setBoardError(null);
    try {
      const { columns: updatedColumns } = await requestApi<{
        columns: BoardColumn[];
      }>(`/api/projects/${selectedProjectId}/columns/reorder`, {
        method: "PATCH",
        body: JSON.stringify({ columnIds: reordered.map((column) => column.id) }),
      });
      setColumns(updatedColumns);
      void reloadActivity();
    } catch (error) {
      setBoardError(
        error instanceof Error ? error.message : "Could not reorder columns.",
      );
    }
  }

  async function handleLogout() {
    setLogoutError(null);
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      setLogoutError(
        error instanceof Error ? error.message : "Could not sign out. Try again.",
      );
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f7fb] text-slate-900">
      <header className="border-b border-slate-200/80 bg-white/90">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-5 py-4 sm:px-8">
          <Link
            to="/"
            aria-label="Taskboard home"
            className="flex items-center gap-3"
          >
            <span className="grid size-10 place-items-center rounded-xl bg-indigo-600 text-lg font-bold text-white shadow-sm shadow-indigo-200">
              t
            </span>
            <span>
              <span className="block text-sm font-bold tracking-tight">
                taskboard
              </span>
              <span className="block text-xs text-slate-500">
                Product workspace
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-slate-500 sm:inline">
              {user?.displayName}
            </span>
            <div
              aria-label={`${user?.displayName ?? "User"} profile`}
              className="grid size-9 place-items-center rounded-full bg-amber-100 text-sm font-semibold text-amber-800"
            >
              {user?.displayName.slice(0, 1).toUpperCase()}
            </div>
            <button
              type="button"
              onClick={handleLogout}
              disabled={loggingOut}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 disabled:opacity-60"
            >
              {loggingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-5 py-8 sm:px-8 sm:py-12">
        {logoutError && (
          <p
            role="alert"
            className="mb-5 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
          >
            {logoutError}
          </p>
        )}
        <section className="mb-9 flex flex-col justify-between gap-5 md:flex-row md:items-end">
          <div>
            <p className="mb-2 text-sm font-semibold text-indigo-600">
              YOUR WORKSPACE
            </p>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
              {selectedProjectId
                ? (projects.find((project) => project.id === selectedProjectId)?.name ??
                  "Your project")
                : "Good work starts here."}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-500 sm:text-base">
              Manage your project workflow in one clear view.
            </p>
          </div>
          {projects.length > 1 && (
            <label className="text-sm font-medium text-slate-600">
              Project
              <select
                value={selectedProjectId}
                onChange={(event) => {
                  setSelectedProjectId(event.target.value);
                  setColumns([]);
                  setCards([]);
                  setActivities([]);
                  setColumnsLoading(true);
                  setActivityLoading(true);
                  setBoardError(null);
                }}
                className="ml-2 rounded-lg border border-slate-300 bg-white px-3 py-2"
              >
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>

        <section
          aria-label="Project columns"
          className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
        >
          <div className="mb-6 flex flex-col gap-3 border-b border-slate-100 pb-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                PROJECT BOARD
              </p>
              <h2 className="mt-1 text-lg font-semibold">Columns</h2>
            </div>
            {selectedProjectId &&
              projects.find((project) => project.id === selectedProjectId)?.role ===
                "owner" && (
                <form
                  onSubmit={handleCreateColumn}
                  className="flex gap-2"
                  aria-label="Create column"
                >
                  <input
                    aria-label="New column name"
                    maxLength={50}
                    value={columnName}
                    onChange={(event) => setColumnName(event.target.value)}
                    placeholder="New column"
                    className="min-w-0 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  />
                  <button
                    type="submit"
                    disabled={creatingColumn || !columnName.trim()}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {creatingColumn ? "Adding…" : "Add column"}
                  </button>
                </form>
              )}
          </div>

          {boardError && (
            <p
              role="alert"
              className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"
            >
              {boardError}
            </p>
          )}
          {projectsLoading || columnsLoading ? (
            <p role="status" className="py-10 text-center text-sm text-slate-500">
              Loading project board…
            </p>
          ) : !projects.length ? (
            <div className="py-8 text-center">
              <p className="text-sm text-slate-500">You don&apos;t have a project yet.</p>
              <ProjectCreateForm
                projectName={projectName}
                setProjectName={setProjectName}
                creating={creatingProject}
                onSubmit={handleCreateProject}
              />
            </div>
          ) : !columns.length ? (
            <p className="py-10 text-center text-sm text-slate-500">
              No columns in this project yet.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {columns.map((column, index) => (
                <section
                  key={column.id}
                  aria-label={`${column.name} column`}
                  className="min-w-0 rounded-xl bg-slate-50/80 p-3 sm:p-4"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const cardId =
                      event.dataTransfer.getData("text/plain") || draggedCardId;
                    if (cardId) void handleMoveCard(cardId, column.id);
                  }}
                >
                  <div className="mb-4 flex items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-semibold">{column.name}</h3>
                    {projects.find((project) => project.id === selectedProjectId)
                      ?.role === "owner" && (
                      <div className="flex shrink-0 gap-1">
                        <button
                          type="button"
                          aria-label={`Move ${column.name} up`}
                          disabled={index === 0}
                          onClick={() => void moveColumn(column.id, -1)}
                          className="grid size-7 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Move ${column.name} down`}
                          disabled={index === columns.length - 1}
                          onClick={() => void moveColumn(column.id, 1)}
                          className="grid size-7 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 disabled:opacity-40"
                        >
                          ↓
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    {cards
                      .filter((card) => card.columnId === column.id)
                      .sort((left, right) => left.position - right.position)
                      .map((card, cardIndex, columnCards) => (
                        <article
                          key={card.id}
                          draggable={!movingCard}
                          onDragStart={(event) => {
                            setDraggedCardId(card.id);
                            event.dataTransfer.setData("text/plain", card.id);
                            event.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => setDraggedCardId(null)}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            const movingId =
                              event.dataTransfer.getData("text/plain") ||
                              draggedCardId;
                            if (movingId && movingId !== card.id) {
                              void handleMoveCard(movingId, column.id, card.id);
                            }
                          }}
                          className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
                        >
                          <h4 className="break-words text-sm font-semibold">
                            {card.title}
                          </h4>
                          {card.description && (
                            <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-600">
                              {card.description}
                            </p>
                          )}
                          {card.labels.length > 0 && (
                            <ul aria-label={`${card.title} labels`} className="mt-2 flex flex-wrap gap-1">
                              {card.labels.map((label) => (
                                <li
                                  key={label}
                                  className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-700"
                                >
                                  {label}
                                </li>
                              ))}
                            </ul>
                          )}
                          {card.dueDate && (
                            <p className="mt-2 text-xs text-slate-500">
                              Due {new Date(card.dueDate).toLocaleDateString()}
                            </p>
                          )}
                          {card.assigneeId && (
                            <p className="mt-1 truncate text-xs text-slate-500">
                              Assignee: {card.assigneeId}
                            </p>
                          )}
                          <div className="mt-3 flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              aria-label={`Move ${card.title} up`}
                              disabled={movingCard || cardIndex === 0}
                              onClick={() =>
                                void handleMoveCard(
                                  card.id,
                                  column.id,
                                  columnCards[cardIndex - 1]?.id,
                                )
                              }
                              className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-40"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              aria-label={`Move ${card.title} down`}
                              disabled={
                                movingCard || cardIndex === columnCards.length - 1
                              }
                              onClick={() =>
                                void handleMoveCard(
                                  card.id,
                                  column.id,
                                  columnCards[cardIndex + 2]?.id,
                                )
                              }
                              className="rounded border border-slate-200 px-2 py-1 text-xs disabled:opacity-40"
                            >
                              ↓
                            </button>
                            <label className="sr-only" htmlFor={`move-${card.id}`}>
                              Move {card.title} to column
                            </label>
                            <select
                              id={`move-${card.id}`}
                              aria-label={`Move ${card.title} to column`}
                              value={column.id}
                              disabled={movingCard}
                              onChange={(event) =>
                                void handleMoveCard(card.id, event.target.value)
                              }
                              className="max-w-28 rounded border border-slate-200 bg-white px-1.5 py-1 text-xs"
                            >
                              {columns.map((destination) => (
                                <option key={destination.id} value={destination.id}>
                                  {destination.name}
                                </option>
                              ))}
                            </select>
                            <details className="ml-auto">
                              <summary className="cursor-pointer text-xs font-medium text-indigo-700">
                                Edit
                              </summary>
                              <CardForm
                                ariaLabel={`Edit ${card.title}`}
                                initialCard={card}
                                currentUserId={currentUserId}
                                submitLabel="Save changes"
                                onSubmit={(fields) =>
                                  handleUpdateCard(card.id, fields)
                                }
                              />
                            </details>
                            <button
                              type="button"
                              onClick={() => void handleDeleteCard(card.id)}
                              className="text-xs font-medium text-rose-700"
                            >
                              Delete
                            </button>
                          </div>
                          <CardComments
                            projectId={selectedProjectId}
                            cardId={card.id}
                            onCommentAdded={() => void reloadActivity()}
                          />
                        </article>
                      ))}
                    {cards.every((card) => card.columnId !== column.id) && (
                      <p className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-5 text-center text-xs text-slate-400">
                        No cards yet
                      </p>
                    )}
                  </div>
                  {createCardColumnId === column.id ? (
                    <CardForm
                      ariaLabel={`Create card in ${column.name}`}
                      currentUserId={currentUserId}
                      submitLabel="Create card"
                      onCancel={() => setCreateCardColumnId(null)}
                      onSubmit={(fields) => handleCreateCard(column.id, fields)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setCreateCardColumnId(column.id)}
                      className="mt-3 w-full rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 hover:border-indigo-300 hover:text-indigo-700"
                    >
                      + Add card
                    </button>
                  )}
                </section>
              ))}
            </div>
          )}
          {projects.length > 0 && (
            <ProjectCreateForm
              projectName={projectName}
              setProjectName={setProjectName}
              creating={creatingProject}
              onSubmit={handleCreateProject}
            />
          )}
        </section>

        {selectedProjectId && (
          <section
            aria-label="Project activity"
            className="mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6"
          >
            <h2 className="text-lg font-semibold">Recent activity</h2>
            {activityLoading ? (
              <p role="status" className="py-5 text-sm text-slate-500">
                Loading activity…
              </p>
            ) : activities.length === 0 ? (
              <p className="py-5 text-sm text-slate-500">
                No project activity yet.
              </p>
            ) : (
              <ol className="mt-4 space-y-3">
                {activities.map((activity) => (
                  <li
                    key={activity.id}
                    className="border-l-2 border-indigo-100 pl-3"
                  >
                    <p className="text-sm text-slate-700">
                      <span className="font-semibold">{activity.actorName}</span>{" "}
                      {describeActivity(activity)}
                    </p>
                    <time
                      dateTime={activity.createdAt}
                      className="mt-1 block text-xs text-slate-400"
                    >
                      {new Date(activity.createdAt).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ol>
            )}
          </section>
        )}

        <p className="mt-6 text-center text-xs text-slate-400">
          A focused space for your next great project.
        </p>
      </main>
    </div>
  );
}

function describeActivity(activity: BoardActivity): string {
  const title = activity.metadata?.title ?? "a card";
  switch (activity.action) {
    case "card.created":
      return `created ${title}${activity.metadata?.toColumn ? ` in ${activity.metadata.toColumn}` : ""}.`;
    case "card.updated":
      return `updated ${title}.`;
    case "card.deleted":
      return `deleted ${title}.`;
    case "card.moved":
      return `moved ${title}${activity.metadata?.fromColumn && activity.metadata.toColumn ? ` from ${activity.metadata.fromColumn} to ${activity.metadata.toColumn}` : ""}.`;
    case "comment.added":
      return `commented on ${title}.`;
    case "column.created":
      return `created the ${activity.metadata?.name ?? "new"} column.`;
    case "column.renamed":
      return `renamed ${activity.metadata?.previousName ?? "a column"} to ${activity.metadata?.name ?? "a new name"}.`;
    case "column.reordered":
      return "reordered the columns.";
  }
}

function CardComments({
  projectId,
  cardId,
  onCommentAdded,
}: {
  projectId: string;
  cardId: string;
  onCommentAdded: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [comments, setComments] = useState<BoardComment[]>([]);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleComments() {
    const willOpen = !open;
    setOpen(willOpen);
    if (!willOpen || loaded) return;
    setError(null);
    setLoading(true);
    try {
      const { comments: latest } = await requestApi<{ comments: BoardComment[] }>(
        `/api/projects/${projectId}/cards/${cardId}/comments`,
      );
      setComments(latest);
      setLoaded(true);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load comments.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function submitComment(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 2000) {
      setError("Comment must be between 1 and 2,000 characters.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { comments: latest } = await requestApi<{ comments: BoardComment[] }>(
        `/api/projects/${projectId}/cards/${cardId}/comments`,
        { method: "POST", body: JSON.stringify({ content: trimmed }) },
      );
      setComments(latest);
      setLoaded(true);
      setContent("");
      onCommentAdded();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Could not add comment.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 border-t border-slate-100 pt-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => void toggleComments()}
        className="text-xs font-medium text-indigo-700 hover:text-indigo-900"
      >
        {open ? "Hide comments" : "Comments"}
      </button>
      {open && (
        <div className="mt-2 space-y-3">
          {loading ? (
            <p role="status" className="text-xs text-slate-500">
              Loading comments…
            </p>
          ) : comments.length === 0 && loaded ? (
            <p className="text-xs text-slate-500">No comments yet.</p>
          ) : (
            <ol className="space-y-2">
              {comments.map((comment) => (
                <li key={comment.id} className="rounded-md bg-slate-50 p-2">
                  <p className="whitespace-pre-wrap break-words text-xs text-slate-700">
                    {comment.content}
                  </p>
                  <p className="mt-1 text-[11px] text-slate-400">
                    {comment.authorName} ·{" "}
                    <time dateTime={comment.createdAt}>
                      {new Date(comment.createdAt).toLocaleString()}
                    </time>
                  </p>
                </li>
              ))}
            </ol>
          )}
          <form onSubmit={submitComment} aria-label="Add comment" className="space-y-2">
            <label className="sr-only" htmlFor={`comment-${cardId}`}>
              Write a comment
            </label>
            <textarea
              id={`comment-${cardId}`}
              maxLength={2000}
              rows={2}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="Write a comment…"
              className="w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-xs"
            />
            {error && (
              <p role="alert" className="text-xs text-rose-700">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submitting || !content.trim()}
              className="rounded-md bg-indigo-600 px-2.5 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {submitting ? "Sending…" : "Add comment"}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function ProjectCreateForm({
  projectName,
  setProjectName,
  creating,
  onSubmit,
}: {
  projectName: string;
  setProjectName: (name: string) => void;
  creating: boolean;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form
      onSubmit={onSubmit}
      className="mx-auto mt-5 flex w-full max-w-md gap-2"
      aria-label="Create project"
    >
      <input
        aria-label="Project name"
        maxLength={80}
        value={projectName}
        onChange={(event) => setProjectName(event.target.value)}
        placeholder="Project name"
        className="min-w-0 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={creating || projectName.trim().length < 2}
        className="rounded-lg bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
      >
        {creating ? "Creating…" : "Create project"}
      </button>
    </form>
  );
}

function CardForm({
  ariaLabel,
  initialCard,
  currentUserId,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  ariaLabel: string;
  initialCard?: BoardCard;
  currentUserId: string;
  submitLabel: string;
  onSubmit: (fields: CardFields) => Promise<void>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initialCard?.title ?? "");
  const [description, setDescription] = useState(initialCard?.description ?? "");
  const [assigneeId, setAssigneeId] = useState(initialCard?.assigneeId ?? "");
  const [dueDate, setDueDate] = useState(
    initialCard?.dueDate ? initialCard.dueDate.slice(0, 10) : "",
  );
  const [labels, setLabels] = useState(initialCard?.labels.join(", ") ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const parsedLabels = labels
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    if (!trimmedTitle || trimmedTitle.length > 120 || description.length > 2000) {
      setError("Enter a title up to 120 characters and description up to 2,000.");
      return;
    }
    if (parsedLabels.length > 8 || parsedLabels.some((label) => label.length > 24)) {
      setError("Use up to 8 labels, each no longer than 24 characters.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onSubmit({
        title: trimmedTitle,
        description,
        assigneeId: assigneeId.trim() || null,
        dueDate: dueDate ? new Date(`${dueDate}T00:00:00.000Z`).toISOString() : null,
        labels: parsedLabels,
      });
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Could not save this card.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      aria-label={ariaLabel}
      onSubmit={submit}
      className="mt-3 space-y-2 rounded-lg border border-slate-200 bg-white p-3"
    >
      <label className="block text-xs font-medium text-slate-600">
        Title
        <input
          required
          maxLength={120}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Description
        <textarea
          maxLength={2000}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
          className="mt-1 w-full resize-y rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Assignee user ID (optional)
        <input
          value={assigneeId}
          onChange={(event) => setAssigneeId(event.target.value)}
          placeholder="Project member ID"
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-xs"
        />
      </label>
      <button
        type="button"
        onClick={() => setAssigneeId(currentUserId)}
        className="text-xs font-medium text-indigo-700 hover:text-indigo-900"
      >
        Assign to me
      </button>
      <label className="block text-xs font-medium text-slate-600">
        Due date
        <input
          type="date"
          value={dueDate}
          onChange={(event) => setDueDate(event.target.value)}
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </label>
      <label className="block text-xs font-medium text-slate-600">
        Labels (comma-separated)
        <input
          value={labels}
          onChange={(event) => setLabels(event.target.value)}
          placeholder="Design, Urgent"
          className="mt-1 w-full rounded-md border border-slate-300 px-2 py-1.5 text-sm"
        />
      </label>
      {error && (
        <p role="alert" className="text-xs text-rose-700">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-200 px-3 py-1.5 text-xs"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
