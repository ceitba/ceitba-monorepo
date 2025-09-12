import express from 'express';
import { ItbaContainer } from '@/shared/container/itba.container';
import { validateRequest } from '@/shared/middleware/validateRequest';
import { validateQuery, validateParams } from '@/shared/middleware/validateParams';
import { errorHandler } from '@/shared/middleware/errorHandler';
import {
    SubjectPlanQuerySchema,
    CreateSubjectPlanSchema,
    UpdateSubjectPlanSchema,
    SubjectPlanParamsSchema,
    ClassroomQuerySchema,
    ClassroomConflictSchema,
    CreateCareerSchema,
    UpdateCareerSchema
} from '@/shared/validation/subject-plan.schemas';

function createItbaRoutes(): express.Router {
    const router = express.Router();
    const container = ItbaContainer.getInstance();
    
    const careerController = container.careerController;
    const classroomController = container.classroomController;
    const subjectPlanController = container.subjectPlanController;

    router.get('/careers', (req, res, next) => careerController.getAllCareers(req, res, next));
    router.get('/careers/plans', (req, res, next) => careerController.getCareerPlans(req, res, next));
    router.get('/careers/:id', (req, res, next) => careerController.getCareerById(req, res, next));
    router.post('/careers', 
        validateRequest(CreateCareerSchema),
        (req, res, next) => careerController.createCareer(req, res, next)
    );
    router.put('/careers/:id', 
        validateRequest(UpdateCareerSchema),
        (req, res, next) => careerController.updateCareer(req, res, next)
    );
    router.delete('/careers/:id', (req, res, next) => careerController.deleteCareer(req, res, next));

    router.get('/classrooms', 
        validateQuery(ClassroomQuerySchema),
        (req, res, next) => classroomController.getClassrooms(req, res, next)
    );
    router.get('/classrooms/building/:building', (req, res, next) => classroomController.getClassroomsByBuilding(req, res, next));
    router.get('/classrooms/day/:day', (req, res, next) => classroomController.getClassroomsByDay(req, res, next));
    router.post('/classrooms/conflicts', 
        validateRequest(ClassroomConflictSchema),
        (req, res, next) => classroomController.checkConflicts(req, res, next)
    );

    router.get('/plans/:planId/subjects', 
        validateQuery(SubjectPlanQuerySchema),
        (req, res, next) => subjectPlanController.getSubjectsByPlan(req, res, next)
    );
    router.get('/plans/:planId/subjects/api', (req, res, next) => subjectPlanController.getSubjectsByPlanFromApi(req, res, next));
    router.post('/plans/:planId/subjects', 
        validateRequest(CreateSubjectPlanSchema),
        (req, res, next) => subjectPlanController.createSubjectPlan(req, res, next)
    );
    
    router.get('/subjects/:subjectId/plans', (req, res, next) => subjectPlanController.getSubjectPlansBySubject(req, res, next));
    router.get('/subjects/:subjectId/dependencies', 
        validateQuery(SubjectPlanQuerySchema),
        (req, res, next) => subjectPlanController.getSubjectDependencies(req, res, next)
    );
    
    router.get('/plans/:planId/subjects/:subjectId', (req, res, next) => subjectPlanController.getSubjectPlan(req, res, next));
    router.put('/plans/:planId/subjects/:subjectId', 
        validateRequest(UpdateSubjectPlanSchema),
        (req, res, next) => subjectPlanController.updateSubjectPlan(req, res, next)
    );
    router.delete('/plans/:planId/subjects/:subjectId', (req, res, next) => subjectPlanController.deleteSubjectPlan(req, res, next));

    router.use(errorHandler);

    return router;
}

export default createItbaRoutes;