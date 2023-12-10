import {
  type NoSerialize,
  component$,
  noSerialize,
  useSignal,
  useVisibleTask$,
  useComputed$,
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
import * as Y from "yjs";
import * as schema from "~/db/schema";
import { WebrtcProvider } from "y-webrtc";
import { WebsocketProvider } from "y-websocket";

export type GameData = {
  black: number;
  guestId: number | null;
  guestName: string | null;
  current: string;
  board: string;
};

export function serializeUint8Array(array: Uint8Array): string {
  return btoa(String.fromCharCode.apply(null, array as unknown as number[]));
}
export function deserializeUint8Array(base64String: string): Uint8Array {
  const binaryString = atob(base64String);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}


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
  async ({ data }, { env, cookie, params }) => {
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
      .set({ data })
      .where(eq(games.id, Number(id)));
  },
  zod$({
    data: z.string(),
  }),
);

export default component$(() => {
  const user = useUser();
  const game = useGame();
  const updateGame = useUpdateGame();

  const loc = useLocation();

  const gameData = useSignal(() => {
    const ydoc = new Y.Doc();
    const binary = deserializeUint8Array(game.value.data);
    Y.applyUpdate(ydoc, binary);
    const metaData = ydoc.getMap<number | null | string>("meta");
    return metaData.toJSON() as GameData;
  });

  const opponent = useSignal(() => {
    if (game.value.hostId === user.value.id) {
      return game.value.guest;
    }
    return game.value.host;
  });

  const ydocSignal = useSignal<NoSerialize<Y.Doc>>();

  const isBlack = useComputed$(() => gameData.value.black === user.value.id);
  const isTurn = useComputed$(() =>
    isBlack.value
      ? gameData.value.current === "1"
      : gameData.value.current === "2",
  );

  const score = useComputed$(() => {
    const { board } = gameData.value;
    const black = board.match(/1/g)?.length ?? 0;
    const white = board.match(/2/g)?.length ?? 0;
    return {
      black,
      white,
    };
  });

  const isOver = useComputed$(() => {
    const { board } = gameData.value;
    const black = board.match(/1/g)?.length ?? 0;
    const white = board.match(/2/g)?.length ?? 0;
    return black + white === 64;
  });

  const winner = useComputed$(() => {
    const { board } = gameData.value;
    const black = board.match(/1/g)?.length ?? 0;
    const white = board.match(/2/g)?.length ?? 0;
    if (black > white) {
      return "1";
    } else if (white > black) {
      return "2";
    } else {
      return "0";
    }
  });

  // eslint-disable-next-line qwik/no-use-visible-task
  useVisibleTask$(async ({ track, cleanup }) => {
    const gameValue = track(() => game.value);

    const ydoc = new Y.Doc();

    ydocSignal.value = noSerialize(ydoc);
    const binary = deserializeUint8Array(gameValue.data);

    Y.applyUpdate(ydoc, binary);

    const meta = ydoc.getMap<number | null | string>("meta");

    if (game.value.guestId === user.value.id && !meta.get("guestId")) {
      meta.set("guestId", user.value.id);
      meta.set("guestName", user.value.name);
    }

    new WebrtcProvider("game-" + gameValue.id, ydoc, {
      signaling: [import.meta.env.PUBLIC_SIGNALING_URL],
    });
    new WebsocketProvider(
      import.meta.env.PUBLIC_WEBSOCKET_URL ?? "ws://localhost:1234",
      "game-" + gameValue.id,
      ydoc,
    );

    meta.observe((event) => {
      const meta = event.currentTarget.toJSON() as GameData;
      if (
        meta.guestName &&
        meta.guestId &&
        !opponent.value &&
        meta.guestId === user.value.id
      ) {
        opponent.value = {
          id: meta.guestId as number,
          name: meta.guestName as string,
        };
      }
      gameData.value = meta;
    });

    ydoc.on("update", () => {
      const binary = Y.encodeStateAsUpdate(ydoc);
      const data = serializeUint8Array(binary);
      updateGame.submit({ data });
    });

    cleanup(() => {
      ydoc.destroy();
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
                Game ID: <span class="font-bold">{game.value.id}</span>
              </p>
              <button
                class="flex items-center gap-2 rounded-lg bg-emerald-200 px-4 py-1 text-emerald-600 hover:bg-emerald-300 active:bg-emerald-400"
                onClick$={() => {
                  const url = new URL("/join/" + game.value.id, loc.url).href;
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
            {gameData.value.board.split("").map((cell, cellIndex) => (
              <>
                {cell === "1" ? (
                  <div class="aspect-square rounded-full bg-black"></div>
                ) : cell === "2" ? (
                  <div class="aspect-square rounded-full bg-white"></div>
                ) : (
                  <button
                    onClick$={() => {
                      const ydoc = ydocSignal.value;
                      if (!ydoc) {
                        return;
                      }

                      const newBoard = gameData.value.board.split("");
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
                          const cell = gameData.value.board[index];
                          if (cell === "0") {
                            break;
                          }
                          if (cell === gameData.value.current) {
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
                          const cell = gameData.value.board[index];
                          if (cell === "0") {
                            break;
                          }
                          if (cell === gameData.value.current) {
                            break;
                          }
                          newBoard[index] = gameData.value.current;
                          i++;
                        }
                      }

                      newBoard[cellIndex] = gameData.value.current;

                      const opponent =
                        gameData.value.current === "1" ? "2" : "1";
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

                      const meta = ydoc.getMap<number | null | string>("meta");
                      ydoc.transact(() => {
                        meta.set(
                          "current",
                          opponentHasMoves ? opponent : gameData.value.current,
                        );
                        meta.set("board", newBoard.join(""));
                      });
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
                {gameData.value.black === user.value.id ? (
                  <div class="flex h-7 w-7 items-center rounded-full border border-gray-400 bg-black shadow"></div>
                ) : (
                  <div class="flex h-7 w-7 items-center rounded-full border border-gray-400 shadow"></div>
                )}
                <p class="text-2xl font-bold">
                  {isBlack.value ? score.value.black : score.value.white}
                </p>
              </div>
              <div class="flex items-center gap-4">
                {isOver.value ? (
                  winner.value === "0" ? (
                    <p class="text-xl font-bold text-gray-500">Draw</p>
                  ) : winner.value === "1" && isBlack.value ? (
                    <p class="text-xl font-bold text-emerald-600">You win!</p>
                  ) : (
                    <p class="text-xl font-bold text-rose-600">You lose</p>
                  )
                ) : isTurn.value ? (
                  <p class="text-xl font-bold text-amber-600">Your turn</p>
                ) : (
                  <p class="text-xl text-gray-500">Opponent's turn</p>
                )}
                {isOver.value ? (
                  <button
                    class="rounded-full bg-slate-200 px-4 py-2 font-medium text-slate-600 hover:bg-slate-300 active:bg-slate-400"
                    onClick$={() => {
                      const ydoc = ydocSignal.value;
                      if (!ydoc) {
                        return;
                      }
                      const meta = ydoc.getMap<number | null | string>("meta");
                      ydoc.transact(() => {
                        meta.set("board", boardInit);
                        meta.set("current", "1");
                        meta.set(
                          "black",
                          isBlack.value && opponent.value
                            ? opponent.value.id
                            : user.value.id,
                        );
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
                ) : null}
              </div>
              <div class="flex items-center justify-end gap-3">
                <p class="text-2xl font-bold">
                  {isBlack.value ? score.value.white : score.value.black}
                </p>
                {gameData.value.black === user.value.id ? (
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
