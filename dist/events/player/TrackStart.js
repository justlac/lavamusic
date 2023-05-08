import { Event } from '../../structures/index.js';
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } from 'discord.js';
export default class TrackStart extends Event {
    constructor(client, file) {
        super(client, file, {
            name: 'trackStart',
        });
    }
    async run(player, track, dispatcher) {
        const guild = this.client.guilds.cache.get(player.connection.guildId);
        if (!guild)
            return;
        const textChannel = guild.channels.cache.get(dispatcher.channelId);
        if (!textChannel)
            return;
        function buttonBuilder() {
            const previousButton = new ButtonBuilder()
                .setCustomId('previous')
                .setLabel(`Previous`)
                .setStyle(ButtonStyle.Secondary)
                .setDisabled(dispatcher.previous ? false : true);
            const resumeButton = new ButtonBuilder()
                .setCustomId('resume')
                .setLabel(player.paused ? `Resume` : `Pause`)
                .setStyle(player.paused ? ButtonStyle.Success : ButtonStyle.Secondary);
            const stopButton = new ButtonBuilder().setCustomId('stop').setLabel(`Stop`).setStyle(ButtonStyle.Danger);
            const skipButton = new ButtonBuilder().setCustomId('skip').setLabel(`Skip`).setStyle(ButtonStyle.Secondary);
            const loopButton = new ButtonBuilder().setCustomId('loop').setLabel(`Loop`).setStyle(ButtonStyle.Secondary);
            return new ActionRowBuilder().addComponents(previousButton, resumeButton, stopButton, skipButton, loopButton);
        }
        const embed = this.client
            .embed()
            .setAuthor({
            name: 'Now Playing',
            iconURL: this.client.user.displayAvatarURL(),
        })
            .setColor(this.client.color.main)
            .setDescription(`**[${track.info.title}](${track.info.uri})**`)
            .setFooter({
            text: `Requested by ${track.info.requester.tag}`,
            iconURL: track.info.requester.avatarURL({}),
        })
            .setThumbnail(track.info.thumbnail)
            .addFields({
            name: 'Duration',
            value: track.info.isStream ? 'LIVE' : this.client.utils.formatTime(track.info.length),
            inline: true,
        }, { name: 'Author', value: track.info.author, inline: true })
            .setTimestamp();
        const message = await textChannel.send({
            embeds: [embed],
            components: [buttonBuilder()],
        });
        dispatcher.nowPlayingMessage = message;
        const collector = message.createMessageComponentCollector({
            filter: (async (b) => {
                if (b.guild.members.me.voice.channel && b.guild.members.me.voice.channelId === b.member.voice.channelId)
                    return true;
                else {
                    b.reply({
                        content: `You are not connected to <#${b.guild.members.me.voice?.channelId ?? 'None'}> to use this buttons.`,
                        ephemeral: true,
                    });
                    return false;
                }
            }),
            //time: track.info.isStream ? 86400000 : track.info.length,
        });
        function checkDj() {
            const djRole = this.client.prisma.dj.findUnique({
                where: {
                    guildId: guild.id,
                },
                include: { roles: true },
            });
            if (djRole && djRole.mode) {
                const djRoles = djRole.roles;
                const findDJRole = guild.members.cache.get(dispatcher.player.connection.guildId).roles.cache.find((x) => djRoles.includes(x.id));
                if (!findDJRole) {
                    if (!guild.members.cache.get(dispatcher.player.connection.guildId).permissions.has(PermissionFlagsBits.ManageGuild)) {
                        return false;
                    }
                }
            }
            return true;
        }
        collector.on('collect', async (interaction) => {
            if (!checkDj()) {
                await interaction.reply({
                    content: `You need to have the DJ role to use this command.`,
                    ephemeral: true,
                });
                return;
            }
            switch (interaction.customId) {
                case 'previous':
                    if (!dispatcher.previous) {
                        await interaction.reply({
                            content: `There is no previous song.`,
                            ephemeral: true,
                        });
                        return;
                    }
                    else
                        dispatcher.previousTrack();
                    if (message)
                        await message.edit({
                            embeds: [
                                embed.setFooter({
                                    text: `Previous by ${interaction.user.tag}`,
                                    iconURL: interaction.user.avatarURL({}),
                                }),
                            ],
                            components: [buttonBuilder()],
                        });
                    break;
                case 'resume':
                    dispatcher.pause();
                    if (message)
                        await message.edit({
                            embeds: [
                                embed.setFooter({
                                    text: `${player.paused ? 'Paused' : 'Resumed'} by ${interaction.user.tag}`,
                                    iconURL: interaction.user.avatarURL({}),
                                }),
                            ],
                            components: [buttonBuilder()],
                        });
                    break;
                case 'stop':
                    dispatcher.stop();
                    if (message)
                        await message.edit({
                            embeds: [
                                embed.setFooter({
                                    text: `Stopped by ${interaction.user.tag}`,
                                    iconURL: interaction.user.avatarURL({}),
                                }),
                            ],
                            components: [],
                        });
                    break;
                case 'skip':
                    if (!dispatcher.queue.length) {
                        await interaction.reply({
                            content: `There is no more song in the queue.`,
                            ephemeral: true,
                        });
                        return;
                    }
                    dispatcher.skip();
                    if (message)
                        await message.edit({
                            embeds: [
                                embed.setFooter({
                                    text: `Skipped by ${interaction.user.tag}`,
                                    iconURL: interaction.user.avatarURL({}),
                                }),
                            ],
                            components: [buttonBuilder()],
                        });
                    break;
                case 'loop':
                    switch (dispatcher.loop) {
                        case 'off':
                            dispatcher.loop = 'repeat';
                            if (message)
                                await message.edit({
                                    embeds: [
                                        embed.setFooter({
                                            text: `Looping by ${interaction.user.tag}`,
                                            iconURL: interaction.user.avatarURL({}),
                                        }),
                                    ],
                                    components: [buttonBuilder()],
                                });
                            break;
                        case 'repeat':
                            dispatcher.loop = 'queue';
                            if (message)
                                await message.edit({
                                    embeds: [
                                        embed.setFooter({
                                            text: `Looping Queue by ${interaction.user.tag}`,
                                            iconURL: interaction.user.avatarURL({}),
                                        }),
                                    ],
                                    components: [buttonBuilder()],
                                });
                            break;
                        case 'queue':
                            dispatcher.loop = 'off';
                            if (message)
                                await message.edit({
                                    embeds: [
                                        embed.setFooter({
                                            text: `Looping Off by ${interaction.user.tag}`,
                                            iconURL: interaction.user.avatarURL({}),
                                        }),
                                    ],
                                    components: [buttonBuilder()],
                                });
                            break;
                    }
                    break;
            }
            await interaction.deferUpdate();
        });
    }
}
/**
 * Project: lavamusic
 * Author: Blacky
 * Company: Coders
 * Copyright (c) 2023. All rights reserved.
 * This code is the property of Coder and may not be reproduced or
 * modified without permission. For more information, contact us at
 * https://discord.gg/ns8CTk9J3e
 */
//# sourceMappingURL=TrackStart.js.map