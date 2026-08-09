import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import {
  automations as automationsApi,
  type Automation,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRun,
  type AutomationTrigger,
} from '@domotique/contract';
import type { Ctx } from '../context.js';
import { registerRoute } from '../http/route.js';
import { AppError, notFound } from '../http/errors.js';
import { buildSummary } from '../automations/summary.js';

/**
 * Scénarios et scènes (CDC §4, onglet 3 du design system).
 *
 * Rappel de modélisation : une **scène** est une automatisation à
 * `trigger.kind === 'manual'`. Il n'y a pas de seconde entité.
 */
export function registerAutomationRoutes(app: FastifyInstance, ctx: Ctx) {
  const { prisma, access, engine, events } = ctx;

  type Row = {
    id: string;
    homeId: string;
    name: string;
    icon: string;
    trigger: unknown;
    conditions: unknown;
    actions: unknown;
    enabled: boolean;
    createdAt: Date;
    runs?: { startedAt: Date; status: string }[];
  };

  /** Noms des appareils cités, pour que le résumé ne montre jamais d'UUID. */
  async function deviceNames(rows: Row[]): Promise<Map<string, string>> {
    const ids = new Set<string>();
    for (const row of rows) {
      const trigger = row.trigger as AutomationTrigger;
      if (trigger.kind === 'sensor') ids.add(trigger.device_id);
      for (const condition of (row.conditions as AutomationCondition[]) ?? []) {
        if (condition.kind === 'device_state') ids.add(condition.device_id);
      }
      for (const action of (row.actions as AutomationAction[]) ?? []) {
        if (action.kind === 'set') ids.add(action.device_id);
      }
    }
    if (ids.size === 0) return new Map();
    const devices = await prisma.device.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, name: true },
    });
    return new Map(devices.map((d) => [d.id, d.name]));
  }

  function toAutomation(row: Row, names: Map<string, string>): Automation {
    const trigger = row.trigger as AutomationTrigger;
    const conditions = (row.conditions as AutomationCondition[]) ?? [];
    const actions = (row.actions as AutomationAction[]) ?? [];
    const last = row.runs?.[0];

    return {
      id: row.id,
      home_id: row.homeId,
      name: row.name,
      icon: row.icon as Automation['icon'],
      trigger,
      conditions,
      actions,
      enabled: row.enabled,
      summary: buildSummary({ trigger, conditions, actions }, names),
      last_run: last
        ? { at: last.startedAt.toISOString(), status: last.status as 'success' }
        : null,
      created_at: row.createdAt.toISOString(),
    };
  }

  const toRun = (r: {
    id: string;
    automationId: string;
    scheduledFor: Date;
    startedAt: Date;
    finishedAt: Date | null;
    status: string;
    failedDeviceIds: string[];
  }): AutomationRun => ({
    id: r.id,
    automation_id: r.automationId,
    scheduled_for: r.scheduledFor.toISOString(),
    started_at: r.startedAt.toISOString(),
    finished_at: r.finishedAt?.toISOString() ?? null,
    status: r.status as AutomationRun['status'],
    failed_device_ids: r.failedDeviceIds,
  });

  /** Refuse une automatisation qui piloterait un appareil d'un autre foyer. */
  async function assertDevicesInHome(homeId: string, actions: AutomationAction[], trigger: AutomationTrigger) {
    const ids = new Set<string>();
    for (const action of actions) if (action.kind === 'set') ids.add(action.device_id);
    if (trigger.kind === 'sensor') ids.add(trigger.device_id);
    if (ids.size === 0) return;

    const count = await prisma.device.count({ where: { id: { in: [...ids] }, homeId } });
    if (count !== ids.size) {
      throw new AppError('validation_failed', 'Un appareil référencé n’appartient pas à ce foyer');
    }
  }

  registerRoute(app, ctx, automationsApi.list, async ({ userId, params }) => {
    await access.requireHome(userId!, params.home_id);
    const rows = await prisma.automation.findMany({
      where: { homeId: params.home_id },
      include: { runs: { orderBy: { startedAt: 'desc' }, take: 1 } },
      orderBy: { createdAt: 'asc' },
    });
    const names = await deviceNames(rows);
    return { items: rows.map((r) => toAutomation(r, names)) };
  });

  registerRoute(app, ctx, automationsApi.create, async ({ userId, params, body }) => {
    await access.requireHome(userId!, params.home_id, 'member');
    await assertDevicesInHome(params.home_id, body.actions, body.trigger);

    const row = await prisma.automation.create({
      data: {
        homeId: params.home_id,
        name: body.name,
        icon: body.icon,
        triggerKind: body.trigger.kind,
        trigger: body.trigger,
        conditions: body.conditions,
        actions: body.actions,
        enabled: body.enabled,
      },
    });
    return { automation: toAutomation(row, await deviceNames([row])) };
  });

  registerRoute(app, ctx, automationsApi.update, async ({ userId, params, body }) => {
    const existing = await prisma.automation.findUnique({ where: { id: params.automation_id } });
    if (!existing) throw notFound('Scénario introuvable');
    await access.requireHome(userId!, existing.homeId, 'member');

    const trigger = (body.trigger ?? existing.trigger) as AutomationTrigger;
    const actions = (body.actions ?? existing.actions) as AutomationAction[];
    if (body.actions || body.trigger) {
      await assertDevicesInHome(existing.homeId, actions, trigger);
    }

    const row = await prisma.automation.update({
      where: { id: params.automation_id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
        ...(body.trigger !== undefined ? { trigger: body.trigger, triggerKind: body.trigger.kind } : {}),
        ...(body.conditions !== undefined ? { conditions: body.conditions } : {}),
        ...(body.actions !== undefined ? { actions: body.actions } : {}),
        ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
      },
      include: { runs: { orderBy: { startedAt: 'desc' }, take: 1 } },
    });
    return { automation: toAutomation(row, await deviceNames([row])) };
  });

  registerRoute(app, ctx, automationsApi.remove, async ({ userId, params }) => {
    const existing = await prisma.automation.findUnique({ where: { id: params.automation_id } });
    if (!existing) throw notFound('Scénario introuvable');
    await access.requireHome(userId!, existing.homeId, 'member');
    await prisma.automation.delete({ where: { id: params.automation_id } });
    return { ok: true as const };
  });

  /**
   * Exécution immédiate (bouton « Lancer » de l'écran 3.1).
   *
   * Distincte de `PATCH { enabled }`, qui n'active que le déclencheur. Confondre
   * les deux est l'erreur classique de cet écran.
   *
   * Idempotent sur `run_id` : un double appui ne lance pas la scène deux fois.
   * Les conditions ne sont **pas** évaluées — un lancement manuel est une
   * intention explicite de l'utilisateur, pas un déclenchement automatique.
   */
  registerRoute(app, ctx, automationsApi.run, async ({ userId, params, body }) => {
    const automation = await prisma.automation.findUnique({
      where: { id: params.automation_id },
    });
    if (!automation) throw notFound('Scénario introuvable');
    await access.requireHome(userId!, automation.homeId, 'guest');

    const existing = await prisma.automationRun.findUnique({ where: { id: body.run_id } });
    if (existing) return { run: toRun(existing) };

    let run;
    try {
      run = await prisma.automationRun.create({
        data: {
          id: body.run_id,
          automationId: automation.id,
          scheduledFor: new Date(),
          status: 'running',
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError('conflict', 'Une exécution est déjà en cours pour cet instant');
      }
      throw error;
    }

    const outcome = await engine.run(automation, run.id);
    const finished = await prisma.automationRun.update({
      where: { id: run.id },
      data: { status: outcome.status, failedDeviceIds: outcome.failedDeviceIds, finishedAt: new Date() },
    });

    await events.publish(automation.homeId, {
      type: 'automation_run_updated',
      run: toRun(finished),
    });
    return { run: toRun(finished) };
  });

  registerRoute(app, ctx, automationsApi.history, async ({ userId, params, query }) => {
    const automation = await prisma.automation.findUnique({
      where: { id: params.automation_id },
    });
    if (!automation) throw notFound('Scénario introuvable');
    await access.requireHome(userId!, automation.homeId);

    const rows = await prisma.automationRun.findMany({
      where: {
        automationId: params.automation_id,
        ...(query.cursor ? { startedAt: { lt: new Date(query.cursor) } } : {}),
      },
      orderBy: { startedAt: 'desc' },
      take: query.limit + 1,
    });

    const page = rows.slice(0, query.limit);
    return {
      items: page.map(toRun),
      next_cursor: rows.length > query.limit ? (page.at(-1)?.startedAt.toISOString() ?? null) : null,
    };
  });
}
