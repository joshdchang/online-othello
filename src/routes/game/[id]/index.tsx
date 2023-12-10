import {
  component$,
  useSignal,
  useComputed$,
  useVisibleTask$,
  useTask$,
  type NoSerialize,
  noSerialize,
} from "@builder.io/qwik";
import {
  Link,
  routeAction$,
  routeLoader$,
  useLocation,
  z,
  zod$,
} from "@builder.io/qwik-city";
import { createClient } from "@libsql/client";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { games } from "~/db/schema";
import { boardInit } from "~/routes/lobby/index";
import * as schema from "~/db/schema";

type Message = {
  id: number;
  board: string;
  currentTurn: string;
  player1: number;
};

export const useUser = routeLoader$(
  async ({ env, cookie, error, redirect }) => {
    const TURSO_URL = env.get("TURSO_URL");
    const TURSO_AUTH_TOKEN = env.get("TURSO_AUTH_TOKEN");

    if (!TURSO_URL || !TURSO_AUTH_TOKEN) {
      throw error(500, "Missing TURSO_URL or TURSO_AUTH_TOKEN");
    }
    const client = createClient({
      url: TURSO_URL,
      authToken: TURSO_AUTH_TOKEN,
    });
    const db = drizzle(client, { schema });

    const userId = cookie.get("userId");
    if (!userId) {
      throw redirect(302, "/");
    }

    const user = await db.query.users.findFirst({
      where: eq(schema.users.id, userId.number()),
      with: {
        guestGames: true,
        hostGames: true,
      },
    });
    if (!user) {
      throw redirect(302, "/");
    }
    return user;
  },
);

export const useGame = routeLoader$(
  async ({ env, cookie, error, redirect, params }) => {
    const TURSO_URL = env.get("TURSO_URL");
    const TURSO_AUTH_TOKEN = env.get("TURSO_AUTH_TOKEN");

    if (!TURSO_URL || !TURSO_AUTH_TOKEN) {
      throw error(500, "Missing TURSO_URL or TURSO_AUTH_TOKEN");
    }

    const { id } = params;
    if (!id) {
      throw redirect(302, "/lobby/");
    }

    const client = createClient({
      url: TURSO_URL,
      authToken: TURSO_AUTH_TOKEN,
    });
    const db = drizzle(client, { schema });

    const userId = cookie.get("userId");
    if (!userId) {
      throw redirect(302, "/");
    }

    const game = await db.query.games.findFirst({
      where: eq(games.id, Number(id)),
      with: {
        guest: true,
        host: true,
      },
    });
    if (!game) {
      throw redirect(302, "/lobby/");
    }

    const isHost = game.hostId === userId.number();
    const isGuest = game.guestId === userId.number();

    if (!isHost && !isGuest) {
      throw redirect(302, "/lobby/");
    }

    return game;
  },
);

export const useUpdateGame = routeAction$(
  async ({ board, currentTurn, player1 }, { env, cookie, params }) => {
    const TURSO_URL = env.get("TURSO_URL");
    const TURSO_AUTH_TOKEN = env.get("TURSO_AUTH_TOKEN");
    if (!TURSO_URL || !TURSO_AUTH_TOKEN) {
      return {
        success: false,
        error: "Missing TURSO_URL or TURSO_AUTH_TOKEN",
      };
    }
    const userId = cookie.get("userId")?.number();
    if (!userId) {
      return {
        success: false,
        error: "Missing userId",
      };
    }

    const { id } = params;
    if (!id) {
      return {
        success: false,
        error: "Missing game id",
      };
    }

    const client = createClient({
      url: TURSO_URL,
      authToken: TURSO_AUTH_TOKEN,
    });
    const db = drizzle(client, { schema });

    await db
      .update(games)
      .set({ board, currentTurn, player1 })
      .where(eq(games.id, Number(id)));
  },
  zod$({
    board: z.string(),
    currentTurn: z.string(),
    player1: z.number(),
  }),
);

export default component$(() => {
  const loc = useLocation();

  const user = useUser();
  const gameInit = useGame();
  const updateGame = useUpdateGame();

  const game = useSignal(gameInit.value);
  useTask$(({ track }) => {
    const gameValue = track(() => gameInit.value);
    game.value = gameValue;
  });

  const opponent = useComputed$(() =>
    game.value.hostId === user.value.id ? game.value.guest : game.value.host,
  );
  const isPlayer1 = useComputed$(() => game.value.player1 === user.value.id);
  const isTurn = useComputed$(() =>
    isPlayer1.value
      ? game.value.currentTurn === "1"
      : game.value.currentTurn === "2",
  );
  const score = useComputed$(() => ({
    player1: game.value.board.match(/1/g)?.length ?? 0,
    player2: game.value.board.match(/2/g)?.length ?? 0,
  }));
  const isOver = useComputed$(
    () => score.value.player1 + score.value.player2 === 64,
  );
  const winner = useComputed$(() => {
    if (score.value.player1 === score.value.player2) {
      return "0";
    }
    return score.value.player1 > score.value.player2 ? "1" : "2";
  });

  const wsConnection = useSignal<NoSerialize<WebSocket>>();

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ cleanup }) => {
    const url = import.meta.env.PUBLIC_WEBSOCKET_URL;
    const connection = new WebSocket(url);

    connection.onopen = () => {
      console.log("WebSocket Client Connected");
      connection.send(
        JSON.stringify({
          id: game.value.id,
          board: game.value.board,
          currentTurn: game.value.currentTurn,
          player1: game.value.player1,
        } satisfies Message),
      );
    };

    connection.onerror = (error) => {
      console.error(`WebSocket Error: ${error}`);
    };

    connection.onmessage = (e) => {
      const msg = JSON.parse(e.data) as Message;
      if (msg.id !== game.value.id) {
        return;
      }
      game.value = {
        ...game.value,
        board: msg.board,
        currentTurn: msg.currentTurn,
        player1: msg.player1,
      };
    };

    connection.onclose = () => {
      console.log("WebSocket Client Disconnected");
    };

    wsConnection.value = noSerialize(connection);

    cleanup(() => {
      connection.close();
    });
  });

  return (
    <>
      <div class="flex h-screen flex-col items-center justify-center p-20">
        <div class="flex w-full max-w-xl flex-col gap-8 rounded-xl border bg-white p-12 shadow">
          <div class="flex w-full items-center justify-between">
            <Link class="text-2xl font-bold" href="/lobby/">
              Othello
            </Link>
            <div class="flex items-center gap-4">
              <p class="rounded-lg bg-gray-100 px-4 py-1 text-gray-500">
                Game ID: <span class="font-bold">{gameInit.value.id}</span>
              </p>
              <button
                class="flex items-center gap-2 rounded-lg bg-emerald-200 px-4 py-1 text-emerald-600 hover:bg-emerald-300 active:bg-emerald-400"
                onClick$={() => {
                  const url = new URL("/join/" + gameInit.value.id, loc.url)
                    .href;
                  navigator.clipboard.writeText(url);
                }}
              >
                Copy invite link
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  stroke-width="2"
                  stroke="currentColor"
                  fill="none"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                  <path d="M9 15l6 -6" />
                  <path d="M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464" />
                  <path d="M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463" />
                </svg>
              </button>
            </div>
          </div>
          <div class="board grid grid-cols-8 gap-1 rounded-xl border-4 border-emerald-400 bg-emerald-600 p-2">
            {game.value.board.split("").map((cell, cellIndex) => (
              <>
                {cell === "1" ? (
                  <div class="aspect-square rounded-full bg-black"></div>
                ) : cell === "2" ? (
                  <div class="aspect-square rounded-full bg-white"></div>
                ) : (
                  <button
                    onClick$={() => {
                      const newBoard = game.value.board.split("");
                      let isLegalMove = false;
                      const validDirections: [number, number][] = [];
                      const x = cellIndex % 8;
                      const y = Math.floor(cellIndex / 8);
                      const directions = [
                        [-1, -1],
                        [0, -1],
                        [1, -1],
                        [-1, 0],
                        [1, 0],
                        [-1, 1],
                        [0, 1],
                        [1, 1],
                      ];
                      for (const [dx, dy] of directions) {
                        let i = 1;
                        while (i < 8) {
                          const nx = x + dx * i;
                          const ny = y + dy * i;
                          if (nx < 0 || nx > 7 || ny < 0 || ny > 7) {
                            break;
                          }
                          const index = ny * 8 + nx;
                          const cell = game.value.board[index];
                          if (cell === "0") {
                            break;
                          }
                          if (cell === game.value.currentTurn) {
                            if (i > 1) {
                              isLegalMove = true;
                              validDirections.push([dx, dy]);
                            }
                            break;
                          }
                          i++;
                        }
                      }

                      if (!isLegalMove) {
                        return;
                      }

                      for (const [dx, dy] of validDirections) {
                        let i = 1;
                        while (i < 8) {
                          const nx = x + dx * i;
                          const ny = y + dy * i;
                          if (nx < 0 || nx > 7 || ny < 0 || ny > 7) {
                            break;
                          }
                          const index = ny * 8 + nx;
                          const cell = game.value.board[index];
                          if (cell === "0") {
                            break;
                          }
                          if (cell === game.value.currentTurn) {
                            break;
                          }
                          newBoard[index] = game.value.currentTurn;
                          i++;
                        }
                      }

                      newBoard[cellIndex] = game.value.currentTurn;

                      const opponent =
                        game.value.currentTurn === "1" ? "2" : "1";
                      let opponentHasMoves = false;
                      for (let i = 0; i < 64; i++) {
                        const x = i % 8;
                        const y = Math.floor(i / 8);
                        for (const [dx, dy] of directions) {
                          let i = 1;
                          while (i < 8) {
                            const nx = x + dx * i;
                            const ny = y + dy * i;
                            if (nx < 0 || nx > 7 || ny < 0 || ny > 7) {
                              break;
                            }
                            const index = ny * 8 + nx;
                            const cell = newBoard[index];
                            if (cell === "0") {
                              break;
                            }
                            if (cell === opponent) {
                              if (i > 1) {
                                opponentHasMoves = true;
                              }
                              break;
                            }
                            i++;
                          }
                        }
                      }

                      updateGame.submit({
                        board: newBoard.join(""),
                        currentTurn: opponentHasMoves
                          ? opponent
                          : game.value.currentTurn,
                        player1: game.value.player1,
                      });
                      game.value = {
                        ...game.value,
                        board: newBoard.join(""),
                        currentTurn: opponentHasMoves
                          ? opponent
                          : game.value.currentTurn,
                      };
                      wsConnection.value?.send(
                        JSON.stringify({
                          id: game.value.id,
                          board: newBoard.join(""),
                          currentTurn: opponentHasMoves
                            ? opponent
                            : game.value.currentTurn,
                          player1: game.value.player1,
                        } satisfies Message),
                      );
                    }}
                    disabled={!isTurn.value}
                    class="aspect-square rounded-full bg-emerald-900/20 hover:bg-emerald-900/40 active:bg-emerald-900/60 disabled:bg-emerald-900/20"
                  ></button>
                )}
              </>
            ))}
          </div>
          <div class="flex flex-col gap-4">
            <div class="flex w-full items-center justify-between">
              <p class="text-gray-700">{user.value.name} (You)</p>
              {opponent.value ? (
                <p class="text-gray-700">{opponent.value.name} (Opponent)</p>
              ) : (
                <p class="text-gray-700">Waiting for opponent...</p>
              )}
            </div>
            <div class="flex w-full items-center justify-between">
              <div class="flex items-center gap-3">
                {game.value.player1 === user.value.id ? (
                  <div class="flex h-7 w-7 items-center rounded-full border border-gray-400 bg-black shadow"></div>
                ) : (
                  <div class="flex h-7 w-7 items-center rounded-full border border-gray-400 shadow"></div>
                )}
                <p class="text-2xl font-bold">
                  {isPlayer1.value ? score.value.player1 : score.value.player2}
                </p>
              </div>
              <div class="flex items-center gap-4">
                {isOver.value && winner.value === "0" && (
                  <p class="text-xl font-bold text-gray-500">Draw</p>
                )}
                {isOver.value && winner.value === "1" && isPlayer1.value && (
                  <p class="text-xl font-bold text-emerald-600">You win!</p>
                )}
                {isOver.value && winner.value === "1" && !isPlayer1.value && (
                  <p class="text-xl font-bold text-rose-600">You lose</p>
                )}
                {!isOver.value && isTurn.value && (
                  <p class="text-xl font-bold text-amber-600">Your turn</p>
                )}
                {!isOver.value && !isTurn.value && (
                  <p class="text-xl text-gray-500">Opponent's turn</p>
                )}
                {isOver.value && (
                  <button
                    class="rounded-full bg-slate-200 px-4 py-2 font-medium text-slate-600 hover:bg-slate-300 active:bg-slate-400"
                    onClick$={() => {
                      updateGame.submit({
                        board: boardInit,
                        currentTurn: "1",
                        player1:
                          game.value.player1 === user.value.id && opponent.value
                            ? opponent.value.id
                            : user.value.id,
                      });
                    }}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      class="icon icon-tabler icon-tabler-refresh"
                      width="24"
                      height="24"
                      viewBox="0 0 24 24"
                      stroke-width="2"
                      stroke="currentColor"
                      fill="none"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <path stroke="none" d="M0 0h24v24H0z" fill="none" />
                      <path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4" />
                      <path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4" />
                    </svg>
                  </button>
                )}
              </div>
              <div class="flex items-center justify-end gap-3">
                <p class="text-2xl font-bold">
                  {isPlayer1.value ? score.value.player2 : score.value.player1}
                </p>
                {game.value.player1 === user.value.id ? (
                  <div class="flex h-7 w-7 items-center rounded-full border border-gray-400 shadow"></div>
                ) : (
                  <div class="flex h-7 w-7 items-center rounded-full border border-gray-400 bg-black shadow"></div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
});
