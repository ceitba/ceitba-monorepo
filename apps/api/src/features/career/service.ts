// service/career/CareerService.

import type { Deps } from '../../deps';
import { isUniqueViolation, withTx } from '../../db/client';
import { ResourceAlreadyExistsError, ResourceNotFoundError } from '../../http/errors';
import type { CareerResponse, CreateCareerRequest, CreatePlanRequest, PlanResponse, UpdateCareerRequest } from './dto';
import * as repo from './repo';

export class CareerService {
  constructor(private readonly deps: Deps) {}

  /** @Transactional(readOnly = true) */
  getAllCareers(): Promise<CareerResponse[]> {
    return withTx(this.deps.db, async (tx) =>
      (await repo.findAllCareers(tx)).map((c) => ({ id: c.id, name: c.name, plans: [] })), { readOnly: true });
  }

  getCareerById(id: string): Promise<CareerResponse> {
    return withTx(this.deps.db, async (tx) => {
      const c = await repo.findCareer(tx, id);
      if (!c) throw new ResourceNotFoundError('Career', id);
      return { id: c.id, name: c.name, plans: [] };
    }, { readOnly: true });
  }

  /** Keyed by career id (id order), plans sorted by plan id. */
  getCareersWithPlans(): Promise<Record<string, CareerResponse>> {
    return withTx(this.deps.db, async (tx) => {
      const byCareer = new Map<string, string[]>();
      for (const p of await repo.findAllPlans(tx)) {
        const list = byCareer.get(p.careerId) ?? [];
        list.push(p.id);
        byCareer.set(p.careerId, list);
      }
      const out: Record<string, CareerResponse> = {};
      for (const c of await repo.findAllCareers(tx)) out[c.id] = { id: c.id, name: c.name, plans: byCareer.get(c.id) ?? [] };
      return out;
    }, { readOnly: true });
  }

  async create(req: CreateCareerRequest): Promise<CareerResponse> {
    const id = req.id!;
    try {
      return await withTx(this.deps.db, async (tx) => {
        if (await repo.careerExists(tx, id)) throw new ResourceAlreadyExistsError('Career', id);
        const saved = await repo.insertCareer(tx, id, req.name!, this.deps.clock.now());
        return { id: saved.id, name: saved.name, plans: [] };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ResourceAlreadyExistsError('Career', id);
      throw e;
    }
  }

  update(id: string, req: UpdateCareerRequest): Promise<CareerResponse> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.findCareer(tx, id))) throw new ResourceNotFoundError('Career', id);
      const saved = await repo.updateCareerName(tx, id, req.name!, this.deps.clock.now());
      return { id: saved.id, name: saved.name, plans: [] };
    });
  }

  /** Plan ids are global (plan.id is the PK): an id used by any career is a conflict. */
  async addPlan(careerId: string, req: CreatePlanRequest): Promise<PlanResponse> {
    const planId = req.id!.trim();
    try {
      return await withTx(this.deps.db, async (tx) => {
        const career = await repo.findCareer(tx, careerId);
        if (!career) throw new ResourceNotFoundError('Career', careerId);
        if (await repo.planExists(tx, planId)) throw new ResourceAlreadyExistsError('Plan', planId);
        const name = req.name === null || req.name.trim() === '' ? planId : req.name.trim();
        const saved = await repo.insertPlan(tx, planId, career.id, name, this.deps.clock.now());
        return { id: saved.id, careerId: career.id, name: saved.name };
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ResourceAlreadyExistsError('Plan', planId);
      throw e;
    }
  }

  /** A career still referenced by plans/users/notes fails on the FK: 409 DataIntegrityViolation. */
  delete(id: string): Promise<void> {
    return withTx(this.deps.db, async (tx) => {
      if (!(await repo.careerExists(tx, id))) throw new ResourceNotFoundError('Career', id);
      await repo.deleteCareer(tx, id);
    });
  }
}
