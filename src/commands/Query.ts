import path from "path";
import fs from "fs-extra";
import { nanoid } from "nanoid";
import { stringify as csvStringify } from "csv";
import { ButtonStyle } from "discord-api-types/v9";
import { ActionRowBuilder, ButtonBuilder, SlashCommandBuilder } from "@discordjs/builders";
import { AttachmentBuilder, AutocompleteInteraction, ButtonInteraction, ChannelSelectMenuInteraction, ChatInputCommandInteraction, CommandInteraction, MentionableSelectMenuInteraction, RoleSelectMenuInteraction, SelectMenuInteraction, UserSelectMenuInteraction } from "discord.js";

import { Bot } from "../Bot";
import { Command } from "../Command";
import { Guild } from "../entity/Guild";
import { QueryResult } from "../entity/QueryResult";
import { WebSocketManager } from "../WebSocketManager";
import { EDatabase, Query as QueryEntity } from "../entity/Query";
import { IQueryResult, QueryController } from "../controller/QueryController";

interface IQueryState {
	id: string;
	interaction: ButtonInteraction | SelectMenuInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction | MentionableSelectMenuInteraction | ChannelSelectMenuInteraction | ChatInputCommandInteraction;
}

export default class Query implements Command {
	public commandName = "query";
	public description = "Manage SQL queries";

	private queries: { [key: string]: IQueryState } = {};

	public constructor() {
		QueryController.instance?.onQueryResult(this.onQueryResult.bind(this));
	}

	public async build(builder: SlashCommandBuilder) {
		builder
			.addSubcommand(subcommand => subcommand
				.setName("add")
				.setDescription("Add a query")
				.addStringOption(option => option
					.setName("name")
					.setDescription("The query's name")
					.setRequired(true))
				.addStringOption(option => option
					.setName("database")
					.setDescription("Which database to run the query against")
					.setRequired(true)
					.setChoices(
						{ name: "Auth", value: "auth" },
						{ name: "Characters", value: "characters" },
						{ name: "World", value: "world" },
						{ name: "Eluna", value: "eluna" },
					))
				.addBooleanOption(option => option
					.setName("admin_query")
					.setDescription("Is an admin role required for this query")
					.setRequired(true))
				.addStringOption(option => option
					.setName("query")
					.setDescription("The SQL query")
					.setRequired(true))
			)
			.addSubcommand(subcommand => subcommand
				.setName("remove")
				.setDescription("Remove a query")
				.addStringOption(option => option
					.setName("query")
					.setDescription("The query to remove")
					.setRequired(true)
					.setAutocomplete(true)
				)
			)
			.addSubcommand(subcommand => subcommand
				.setName("list")
				.setDescription("Print a list of available queries")
			)
			.addSubcommand(subcommand => subcommand
				.setName("show")
				.setDescription("Print the contents and usage of a specified query")
				.addStringOption(option => option
					.setName("query")
					.setDescription("The query to print")
					.setRequired(true)
					.setAutocomplete(true)
				)
			)
			.addSubcommand(subcommand => {
				subcommand
					.setName("run")
					.setDescription("Run a query against the server's database")
					.addStringOption(option => option
						.setName("query")
						.setDescription("The query to run")
						.setRequired(true)
						.setAutocomplete(true));
				for (let i = 0; i < 10; ++i) {
					subcommand
						.addStringOption(option => option
							.setName(`arg${i + 1}`)
							.setDescription(`Argument ${i + 1}`)
							.setRequired(false));
				}
				return subcommand;
			})
			.addSubcommand(subcommand => subcommand
				.setName("free")
				.setDescription("Run a query against the server's database without selecting a pre-built query")
				.addStringOption(option => option
					.setName("database")
					.setDescription("Which database to run the query against")
					.setRequired(true)
					.setChoices(
						{ name: "Auth", value: "auth" },
						{ name: "Characters", value: "characters" },
						{ name: "World", value: "world" },
						{ name: "Eluna", value: "eluna" },
					))
				.addStringOption(option => option
					.setName("query")
					.setDescription("The SQL query")
					.setRequired(true))
			);
	}

	public async execute(interaction: CommandInteraction) {
		if (!interaction?.isChatInputCommand()) {
			return;
		}
		const cmd = interaction.options.getSubcommand();
		if (cmd === "add") await this.add(interaction);
		else if (cmd === "remove") await this.remove(interaction);
		else if (cmd === "list") await this.list(interaction);
		else if (cmd === "show") await this.show(interaction);
		else if (cmd === "run") await this.run(interaction);
		else if (cmd === "free") await this.free(interaction);
	}

	private async add(interaction: CommandInteraction) {
		if (!interaction?.isChatInputCommand()) {
			return;
		}

		const guild = await Guild.findOrCreate(interaction.guildId ?? "");
		if (!(await guild.isMemberAdmin(interaction.user.id))) {
			await interaction.reply("❌ You need an administrator role to add queries.");
			return;
		}

		const name = interaction.options.getString("name");
		const dbName = interaction.options.getString("database");
		const admin = interaction.options.getBoolean("admin_query");
		const code = interaction.options.getString("query");
		if (!interaction || !name || !dbName || !code) {
			return;
		}

		const found = await QueryEntity.findOne(name, guild);
		if (found) {
			await interaction.reply(`❌ A query already exists with the name ${name}.`);
			return;
		}

		let database: EDatabase;
		try {
			database = this.getDatabaseFromName(dbName);
		} catch (error) {
			await interaction.reply(`❌ ${error}`);
			return;
		}

		await QueryEntity.save(name, code, database, admin ?? false, guild);
		await interaction.reply(`✅ Query \`${name}\` added.`);
	}

	private async remove(interaction: CommandInteraction) {
		if (!interaction?.isChatInputCommand()) {
			return;
		}

		const name = interaction.options.getString("query");
		if (!name) {
			return;
		}

		const guild = await Guild.findOrCreate(interaction.guildId ?? "");
		if (!(await guild.isMemberAdmin(interaction.user.id))) {
			await interaction.reply("❌ You need an administrator role to remove queries.");
			return;
		}

		const query = await QueryEntity.findOne(name, guild);
		if (!query) {
			await interaction.reply(`❌ Could not find query \`${name}\`.`);
			return;
		}

		await query.delete();
		await interaction.reply(`✅ Query \`${query.name}\` has been removed.`);
	}

	private async list(interaction: CommandInteraction) {
		if (!interaction) {
			return;
		}

		const guild = await Guild.findOrCreate(interaction.guildId ?? "");
		const queries = await QueryEntity.findAll(guild);
		if (queries.length === 0) {
			await interaction.reply("❌ There are no stored queries.");
			return;
		}

		const groups: { [key: number]: QueryEntity[] } = {
			[EDatabase.Auth]: [],
			[EDatabase.Characters]: [],
			[EDatabase.World]: [],
			[EDatabase.Eluna]: [],
		};
		for (const q of queries) {
			groups[q.database].push(q);
		}

		let reply = "";
		for (const db in groups) {
			if (groups[db].length === 0) {
				continue;
			}

			reply += `\n__**${EDatabase[db]}**__\n`;

			for (const q of groups[db].sort((a, b) => a.name.localeCompare(b.name))) {
				reply += q.name + "\n";
			}
		}
		reply = reply.trim();

		const split = Bot.splitMessage(reply);

		await interaction.reply(split.shift() ?? "");
		for (const msg of split) {
			await interaction.followUp(msg);
		}
	}

	private async show(interaction: CommandInteraction) {
		if (!interaction?.isChatInputCommand()) {
			return;
		}
		const name = interaction.options.getString("query");
		if (!name) {
			return;
		}

		const guild = await Guild.findOrCreate(interaction.guildId ?? "");
		const query = await QueryEntity.findOne(name, guild);
		if (!query) {
			await interaction.reply(`❌ Could not find query \`${name}\`.`);
			return;
		}

		const args = query.getArguments().map((arg, idx) => `Argument ${idx + 1}: ${arg}`);
		const argsStr = args.length > 0 ? args.join("\n") : "No arguments";
		await interaction.reply(`**${query.name}**\n${query.getDatabaseName()} Database\n\`\`\`SQL\n${query.query}\n\`\`\`\n${argsStr}`);
	}

	private async run(interaction: CommandInteraction) {
		if (!interaction?.isChatInputCommand()) {
			return;
		}
		const name = interaction.options.getString("query");
		if (!name) {
			return;
		}

		const guild = await Guild.findOrCreate(interaction.guildId ?? "");
		const query = await QueryEntity.findOne(name, guild);
		if (!query) {
			await interaction.reply(`❌ Could not find query \`${name}\`.`);
			return;
		}

		if (query.adminQuery) {
			const guild = await Guild.findOrCreate(interaction.guildId ?? "");
			if (!(await guild.isMemberAdmin(interaction.user.id))) {
				await interaction.reply(`❌ You need an administrator role to run \`${query.name}\`.`);
				return;
			}
		}

		let idx = 0;
		const args: string[] = [];
		for (const arg of query.getArguments()) {
			const value = interaction.options.getString(`arg${idx + 1}`);
			if (!value) {
				await interaction.reply(`❌ Missing argument ${idx + 1}: \`${arg}\``);
				return;
			}
			args.push(value);
			++idx;
		}

		const execute = async (query: QueryEntity, interaction: ButtonInteraction | SelectMenuInteraction | UserSelectMenuInteraction | RoleSelectMenuInteraction | MentionableSelectMenuInteraction | ChannelSelectMenuInteraction | ChatInputCommandInteraction) => {
			await interaction.deferReply();
			const id = nanoid();
			const success = WebSocketManager.instance.sendQuery(id, query.getFormattedQuery(args), query.database);
			if (!success) {
				await interaction.editReply("❌ Could not execute query.");
			} else {
				this.queries[id] = {
					id,
					interaction,
				};
			}
		};

		if (query.query.includes("INSERT ") || query.query.includes("UPDATE ") || query.query.includes("DELETE ")) {
			const confirmEmoji = Bot.instance.randomConfirmEmoji();
			const confirmButton = new ButtonBuilder()
				.setCustomId("query-run-confirm")
				.setLabel("Run")
				.setStyle(ButtonStyle.Primary);
			if (confirmEmoji) {
				confirmButton.setEmoji({ id: confirmEmoji });
			}
			const row = new ActionRowBuilder<ButtonBuilder>()
				.addComponents(confirmButton);
			const response = await interaction.reply({
				content: `Run this query?\n\`\`\`SQL\n${query.getFormattedQuery(args)}\n\`\`\``,
				components: [row],
			});

			const filter = (click) => click.user.id === interaction.user.id;
			const collector = response.createMessageComponentCollector({
				time: 600000,
				filter,
			});

			collector?.on("collect", async (interaction) => {
				await execute(query, interaction);
			});
		} else {
			execute(query, interaction);
		}
	}

	public async free(interaction: CommandInteraction) {
		if (!interaction?.isChatInputCommand()) {
			return;
		}

		const guild = await Guild.findOrCreate(interaction.guildId ?? "");
		if (!(await guild.isMemberAdmin(interaction.user.id))) {
			await interaction.reply("❌ You need an administrator role to run free queries.");
			return;
		}

		const dbName = interaction.options.getString("database", true);
		const sql = interaction.options.getString("query", true);

		let database: EDatabase;
		try {
			database = this.getDatabaseFromName(dbName);
		} catch (error) {
			await interaction.reply(`❌ ${error}`);
			return;
		}

		await interaction.deferReply();
		const id = nanoid();
		const success = WebSocketManager.instance.sendQuery(id, sql, database);
		if (!success) {
			await interaction.editReply("❌ Could not execute query.");
		} else {
			this.queries[id] = {
				id,
				interaction,
			};
		}
	}

	public async autocomplete(interaction: AutocompleteInteraction) {
		if (!interaction) {
			return;
		}

		const input = interaction.options.getFocused(true);
		const guild = await Guild.findOrCreate(interaction.guildId ?? "");
		const isAdmin = await guild.isMemberAdmin(interaction.user.id);

		if (input.name === "query") {
			let queries = await QueryEntity.find(input.value, guild);
			queries = queries.slice(0, 25);
			await interaction.respond(queries
				.filter(q => isAdmin || !q.adminQuery)
				.map(q => q.name)
				.sort((a, b) => a.localeCompare(b))
				.map(q => {
					return {
						name: q,
						value: q,
					};
				}));
		}
	}

	private async onQueryResult(result: IQueryResult) {
		const query = this.queries[result.queryId];
		if (!query) {
			return;
		}

		if (!result.success) {
			await query.interaction.editReply(result.error ? `❌ Query failed: ${result.error}` : "❌ Query failed.");
			return;
		}

		if (result.data.length === 0) {
			if (result.affectedRows === 0) {
				await query.interaction.editReply("No rows found / 0 rows affected.");
			} else {
				await query.interaction.editReply(`${result.affectedRows} row${result.affectedRows === 1 ? "" : "s"} affected.`);
			}
			return;
		}

		await fs.ensureDir(Bot.instance.tmpQueryResultsDir);
		await fs.writeFile(path.join(Bot.instance.tmpQueryResultsDir, `${query.id}.json`), JSON.stringify({
			columns: result.columns,
			data: result.data.map(row => result.columns.map(col => (row as object)[col])),
		}));

		csvStringify(result.data, {
			header: true,
		}, async (err, output) => {
			if (err) {
				console.error(err);
				return;
			}

			const filePath = path.join(Bot.instance.tmpQueryResultsDir, `${query.id}.csv`);
			await fs.writeFile(filePath, output);
			const queryResult = new QueryResult(query.id);
			await queryResult.save();
			const txt = `http://${Bot.instance.config.httpHost}:${Bot.instance.config.httpPort}/query/${query.id}`;
			await query.interaction.editReply({
				content: txt,
				files: [
					new AttachmentBuilder(filePath),
				],
			});
		});
	}

	private getDatabaseFromName(dbName: string): EDatabase {
		switch (dbName) {
			case "auth":
				return EDatabase.Auth;
			case "characters":
				return EDatabase.Characters;
			case "world":
				return EDatabase.World;
			case "eluna":
				return EDatabase.Eluna;
			default:
				throw new Error(`Invalid database ${dbName}.`);
		}
	}
}
