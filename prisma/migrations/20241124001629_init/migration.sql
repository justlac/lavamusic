-- CreateTable
CREATE TABLE "Bot" (
    "botId" TEXT NOT NULL,
    "totalPlaySong" INTEGER NOT NULL
);

-- CreateTable
CREATE TABLE "Guild" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "prefix" TEXT NOT NULL,
    "language" TEXT DEFAULT 'EnglishUS'
);

-- CreateTable
CREATE TABLE "Stay" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "textId" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    CONSTRAINT "Stay_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("guildId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Dj" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "mode" BOOLEAN NOT NULL,
    CONSTRAINT "Dj_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("guildId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Role" (
    "guildId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    CONSTRAINT "Role_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("guildId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Playlist" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tracks" TEXT
);

-- CreateTable
CREATE TABLE "Setup" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "textId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    CONSTRAINT "Setup_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild" ("guildId") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Bot_botId_key" ON "Bot"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_guildId_roleId_key" ON "Role"("guildId", "roleId");

-- CreateIndex
CREATE UNIQUE INDEX "Playlist_userId_name_key" ON "Playlist"("userId", "name");
