// commands/modules/circuitbreaker.js
// Owner-only slash commands for circuit breaker approval/denial

const { requestApproval, resolveApproval, listPendingApprovals } = require('../../circuitBreaker');
const { OWNER_ID } = process.env;

module.exports = {
  data: {
    name: 'circuitbreaker',
    description: 'Owner-only: Approve, deny, or list circuit breaker requests',
    options: [
      {
        name: 'approve',
        type: 1, // SUB_COMMAND
        description: 'Approve a pending request',
        options: [{ name: 'id', type: 3, description: 'Approval ID', required: true }]
      },
      {
        name: 'deny',
        type: 1, // SUB_COMMAND
        description: 'Deny a pending request',
        options: [{ name: 'id', type: 3, description: 'Approval ID', required: true }]
      },
      {
        name: 'list',
        type: 1, // SUB_COMMAND
        description: 'List all pending circuit breaker requests'
      },
      {
        name: 'debug',
        type: 1, // SUB_COMMAND
        description: 'Demo/test the circuit breaker approval flow'
      }
    ]
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
      const approvalId = require('../../circuitBreaker').requestApproval(details,
        () => interaction.followUp({ content: `✅ Debug action approved by owner.`, ephemeral: true }),
        () => interaction.followUp({ content: `🚫 Debug action denied by owner.`, ephemeral: true })
      );
      // DM the owner
      const ownerUser = await interaction.client.users.fetch(process.env.OWNER_ID);
      if (ownerUser) {
        await ownerUser.send(
          `🚨 Circuit Breaker Approval Needed (Debug)\nType: debug\nUser: ${interaction.user.tag}\nContext: Debug circuit breaker test\nID: ${approvalId}\n\nApprove: /circuitbreaker approve id:${approvalId}\nDeny: /circuitbreaker deny id:${approvalId}`
        ).catch(() => {});
      }
      await interaction.reply({ content: `Circuit breaker triggered. Owner notified for approval. (ID: ${approvalId})`, ephemeral: true });
      return;
    }
    if (sub === 'approve') {
      const id = interaction.options.getString('id');
      const ok = resolveApproval(id, 'approve');
      await interaction.reply({ content: ok ? `✅ Approved request ${id}` : `❌ No pending request ${id}`, ephemeral: true });
    } else if (sub === 'deny') {
      const id = interaction.options.getString('id');
      const ok = resolveApproval(id, 'deny');
      await interaction.reply({ content: ok ? `🚫 Denied request ${id}` : `❌ No pending request ${id}`, ephemeral: true });
    } else if (sub === 'list') {
      const pending = listPendingApprovals();
      if (!pending.length) {
        await interaction.reply({ content: 'No pending approvals.', ephemeral: true });
      } else {
        await interaction.reply({ content: pending.map(p => `ID: ${p.id}\nType: ${p.type}\nUser: ${p.user || 'N/A'}\nContext: ${p.context || ''}\nRequested: <t:${Math.floor(p.requestedAt/1000)}:R>`).join('\n\n'), ephemeral: true });
      }
    }
  }
};
