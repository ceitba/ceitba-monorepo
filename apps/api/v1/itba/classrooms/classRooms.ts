import express from "express";
import supabase from "../../config/supabase";
import { ClassroomResponse,ClassroomData } from "./models";
const router = express.Router();

/**
 * @openapi
 * components:
 *   schemas:
 *     ClassroomData:
 *       type: object
 *       properties:
 *         class_room:
 *           type: string
 *         building:
 *           type: string
 *         day:
 *           type: string
 *         hour_from:
 *           type: string
 *         hour_to:
 *           type: string
 *     ClassroomOutput:
 *       type: object
 *       additionalProperties:
 *         type: array
 *         items:
 *           $ref: '#/components/schemas/ClassroomData'
 * /itba/classrooms:
 *   get:
 *     tags:
 *       - ITBA
 *     summary: Retrieve classroom data
 *     description: >
 *       Retrieves a list of classrooms.
 *       The optional "current_semester" query parameter determines whether to filter
 *       results only for the current semester. Otherwise, all classrooms in the database are returned.
 *     parameters:
 *       - in: query
 *         name: current_semester
 *         required: false
 *         schema:
 *           type: boolean
 *         description: If set to true, only returns active classrooms for the current semester.
 *     responses:
 *       200:
 *         description: A map of days to arrays of classroom data.
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ClassroomOutput'
 *       500:
 *         description: Internal server error
 */
router.get("/classrooms", async (req, res) => {
    const { current_semester } = req.query;

    //Current semester toma segun la fecha de hoy, se podria cambiar para que tome la fecha del cuatrimestre mas cercano, ya que durante las vacaciones
    //se muestra la info de las clases de vacaciones nada mas.
    
    
    const {data,error} = await supabase.rpc('get_classrooms',{current_semester:current_semester ?? true});
        if (error) {
            res.status(500).json({ error: error.message });
            return;
        }
        const classroomsMap = (data as ClassroomResponse).reduce((acc, classroom) => {
            const day = classroom.day;
            if (!acc[day]) {
            acc[day] = [];
            }
            acc[day].push(classroom);
            return acc;
        }, {} as { [key: string]: ClassroomData[] });

        res.status(200).json(classroomsMap);

});
export default router;