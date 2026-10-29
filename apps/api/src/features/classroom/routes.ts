// web/classroom/ClassroomController. Public (policy URL rules).

import type { z } from 'zod';
import { defineRoutes } from '../../http/router';
import { jv, param } from '../../http/validation';
import { linkedJson } from '../commission/logic/linkedJson';
import { ClassroomService } from './service';

/** ConflictRequest: every field @NotBlank. */
const ConflictRequest = jv.object({
  classroom: jv.string({ notBlank: true }),
  building: jv.string({ notBlank: true }),
  day: jv.string({ notBlank: true }),
  hourFrom: jv.string({ notBlank: true }),
  hourTo: jv.string({ notBlank: true }),
});
type ConflictRequest = NonNullable<z.output<typeof ConflictRequest>>;

export default defineRoutes((r, deps) => {
  const svc = new ClassroomService(deps);
  const tags = ['Classrooms'];

  r.get('/v1/classrooms', {
    tags, summary: 'Get classrooms with filters',
    query: { status: param.string({ required: false }), current_semester: param.bool({ def: true }) },
  }, async ({ query }) => linkedJson(await svc.getClassroomsWithFilters(query.status, query.current_semester!)));

  r.get('/v1/classrooms/availability', {
    tags, summary: 'Free classrooms per building',
    query: { day: param.string({ required: false }), building: param.string({ required: false }), at: param.string({ required: false }), minMinutes: param.int({ required: false }) },
  }, ({ query }) => svc.getAvailability(query.day, query.building, query.at, query.minMinutes));

  r.get('/v1/classrooms/building/{building}', { tags, summary: 'Get classrooms by building', params: { building: param.string() } },
    ({ params }) => svc.getClassroomsByBuilding(params.building!));

  r.get('/v1/classrooms/day/{day}', { tags, summary: 'Get classrooms by day', params: { day: param.string() } },
    ({ params }) => svc.getClassroomsByDay(params.day!));

  r.post('/v1/classrooms/conflicts', { tags, summary: 'Check for classroom conflicts', body: ConflictRequest },
    ({ body }: { body: ConflictRequest }) => svc.findConflicts(body.classroom!, body.building!, body.day!, body.hourFrom!, body.hourTo!));
});
