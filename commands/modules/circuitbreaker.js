// commands/modules/circuitbreaker.js
/* eslint-disable */
// Owner-only slash commands for circuit breaker approval/denial
// NOTE: This file is disabled to avoid conflict with circuitBreakerCommand.js

// This file is disabled but we keep the imports to avoid linting errors
const {
  requestApproval,
  resolveApproval,
  listPendingApprovals,
} = require('../../src/middleware/circuitBreaker');
const { OWNER_ID } = process.env;
const { SlashCommandBuilder } = require('discord.js');

// This module is disabled to avoid command name conflicts
// with circuitBreakerCommand.js which is the primary implementation
module.exports = {
  name: 'circuit-admin',
  aliases: ['cb', 'breaker'],
  description: 'Owner-only: Approve, deny, or list circuit breaker requests',
  dmAllowed: true,
  ownerOnly: true,

  // Use SlashCommandBuilder instead of raw data object
  slashCommand: new SlashCommandBuilder()
    .setName('circuit-admin')
    .setDescription('Owner-only: Approve, deny, or list circuit breaker requests')
    .addSubcommand(subcommand =>
      subcommand
        .setName('approve')
        .setDescription('Approve a pending request')
        .addStringOption(option =>
          option.setName('id').setDescription('Approval ID').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('deny')
        .setDescription('Deny a pending request')
        .addStringOption(option =>
          option.setName('id').setDescription('Approval ID').setRequired(true)
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('list').setDescription('List all pending circuit breaker requests')
    )
    .addSubcommand(subcommand =>
      subcommand.setName('debug').setDescription('Demo/test the circuit breaker approval flow')
    ),

  // Keep the old data format for backward compatibility
  data: {
    name: 'circuit-admin',
    description: 'Owner-only: Approve, deny, or list circuit breaker requests',
    dmAllowed: true,
    options: [
      {
        name: 'approve',
        type: 1, // SUB_COMMAND
        description: 'Approve a pending request',
        options: [{ name: 'id', type: 3, description: 'Approval ID', required: true }],
      },
      {
        name: 'deny',
        type: 1, // SUB_COMMAND
        description: 'Deny a pending request',
        options: [{ name: 'id', type: 3, description: 'Approval ID', required: true }],
      },
      {
        name: 'list',
        type: 1, // SUB_COMMAND
        description: 'List all pending circuit breaker requests',
      },
      {
        name: 'debug',
        type: 1, // SUB_COMMAND
        description: 'Demo/test the circuit breaker approval flow',
      },
    ],
  },
  async execute(interaction) {
    if (interaction.user.id !== OWNER_ID) {
      await interaction.reply({ content: 'Owner only.', ephemeral: true });
      return;
    }
    const sub = interaction.options.getSubcommand();
    if (sub === 'debug') {
      // Trigger a test approval
      const details = {
        type: 'debug',
        user: interaction.user.tag,
        context: 'Debug circuit breaker test',
      };
      const approvalId = require('../../src/middleware/circuitBreaker').requestApproval(
        details,
        () =>
          interaction.followUp({ content: `✅ Debug action approved by owner.`, ephemeral: true }),
        () => interaction.followUp({ content: `🚫 Debug action denied by owner.`, ephemeral: true })
      );
      // DM the owner
      const ownerUser = await interaction.client.users.fetch(process.env.OWNER_ID);
      if (ownerUser) {
        await ownerUser
          .send(
            `🚨 Circuit Breaker Approval Needed (Debug)\nType: debug\nUser: ${interaction.user.tag}\nContext: Debug circuit breaker test\nID: ${approvalId}\n\nApprove: /circuitbreaker approve id:${approvalId}\nDeny: /circuitbreaker deny id:${approvalId}`
          )
          .catch(() => {});
      }
      await interaction.reply({
        content: `Circuit breaker triggered. Owner notified for approval. (ID: ${approvalId})`,
        ephemeral: true,
      });
      return;
    }
    if (sub === 'approve') {
      const id = interaction.options.getString('id');
      const ok = resolveApproval(id, 'approve');
      await interaction.reply({
        content: ok ? `✅ Approved request ${id}` : `❌ No pending request ${id}`,
        ephemeral: true,
      });
    } else if (sub === 'deny') {
      const id = interaction.options.getString('id');
      const ok = resolveApproval(id, 'deny');
      await interaction.reply({
        content: ok ? `🚫 Denied request ${id}` : `❌ No pending request ${id}`,
        ephemeral: true,
      });
    } else if (sub === 'list') {
      const pending = listPendingApprovals();
      if (!pending.length) {
        await interaction.reply({ content: 'No pending approvals.', ephemeral: true });
      } else {
        await interaction.reply({
          content: pending
            .map(
              p =>
                `ID: ${p.id}\nType: ${p.type}\nUser: ${p.user || 'N/A'}\nContext: ${p.context || ''}\nRequested: <t:${Math.floor(p.requestedAt / 1000)}:R>`
            )
            .join('\n\n'),
          ephemeral: true,
        });
      }
    }
  },
};
