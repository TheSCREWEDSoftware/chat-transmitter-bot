import { MigrationInterface, QueryRunner } from "typeorm";

export class anticheatReportChannel1660386716116 implements MigrationInterface {
	name = "anticheatReportChannel1660386716116";

	public async up(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`CREATE TABLE "temporary_guild" ("discord_id" varchar PRIMARY KEY NOT NULL, "misc_channel" varchar, "anticheat_reports_channel" varchar)`);
		await queryRunner.query(`INSERT INTO "temporary_guild"("discord_id", "misc_channel") SELECT "discord_id", "misc_channel" FROM "guild"`);
		await queryRunner.query(`DROP TABLE "guild"`);
		await queryRunner.query(`ALTER TABLE "temporary_guild" RENAME TO "guild"`);
	}

	public async down(queryRunner: QueryRunner): Promise<void> {
		await queryRunner.query(`ALTER TABLE "guild" RENAME TO "temporary_guild"`);
		await queryRunner.query(`CREATE TABLE "guild" ("discord_id" varchar PRIMARY KEY NOT NULL, "misc_channel" varchar)`);
		await queryRunner.query(`INSERT INTO "guild"("discord_id", "misc_channel") SELECT "discord_id", "misc_channel" FROM "temporary_guild"`);
		await queryRunner.query(`DROP TABLE "temporary_guild"`);
	}
}
