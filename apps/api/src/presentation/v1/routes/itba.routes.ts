import express from 'express';
import { ItbaContainer } from '../../../shared/container/itba.container';

const router = express.Router();

const container = ItbaContainer.getInstance();

const careerController = container.careerController;
const classroomController = container.classroomController;
const subjectPlanController = container.subjectPlanController;

// Career routes
router.get('/career/plans', (req, res) => careerController.getCareerPlans(req, res));
router.get('/career/:id', (req, res) => careerController.getCareerById(req, res));
router.get('/career', (req, res) => careerController.getAllCareers(req, res));
router.post('/career', (req, res) => careerController.createCareer(req, res));
router.put('/career/:id', (req, res) => careerController.updateCareer(req, res));
router.delete('/career/:id', (req, res) => careerController.deleteCareer(req, res));

// Classroom routes
router.get('/classrooms/occupied', (req, res) => classroomController.getOccupiedClassrooms(req, res));
router.get('/classrooms/all', (req, res) => classroomController.getAllClassrooms(req, res));
router.get('/classrooms/available', (req, res) => classroomController.getAvailableClassrooms(req, res));
router.get('/classrooms/building/:building', (req, res) => classroomController.getClassroomsByBuilding(req, res));
router.get('/classrooms/day/:day', (req, res) => classroomController.getClassroomsByDay(req, res));
router.post('/classrooms/conflicts', (req, res) => classroomController.checkConflicts(req, res));

// Subject plan routes
router.get('/subjects/plan/:planId', (req, res) => subjectPlanController.getSubjectsByPlan(req, res));
router.get('/subjects/plan/:planId/api', (req, res) => subjectPlanController.getSubjectsByPlanFromApi(req, res));
router.get('/subjects/:subjectId/plans', (req, res) => subjectPlanController.getSubjectPlansBySubject(req, res));
router.get('/subjects/plan/:planId/section/:section', (req, res) => subjectPlanController.getSubjectsBySection(req, res));
router.get('/subjects/plan/:planId/electives', (req, res) => subjectPlanController.getElectiveSubjects(req, res));
router.get('/subjects/plan/:planId/year/:year', (req, res) => subjectPlanController.getSubjectsByYear(req, res));
router.get('/subjects/plan/:planId/year/:year/semester/:semester', (req, res) => subjectPlanController.getSubjectsBySemester(req, res));
router.get('/subjects/plan/:planId/subject/:subjectId/dependencies', (req, res) => subjectPlanController.getSubjectDependencies(req, res));
router.post('/subjects/plan', (req, res) => subjectPlanController.createSubjectPlan(req, res));

export default router;
