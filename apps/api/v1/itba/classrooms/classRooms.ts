import express from "express";
import supabase from "../../config/supabase";
import { ClassroomResponse,ClassroomData } from "./models";
const router = express.Router();

/**
 * @openapi
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
 *         description: A map of buildings to arrays of classroom data.
 *       500:
 *         description: An error occurred during processing.
 */
router.get("/classrooms", async (req, res) => {
    const { current_semester } = req.query;

    //Current semester toma segun la fecha de hoy, se podria cambiar para que tome la fecha del cuatrimestre mas cercano, ya que durante las vacaciones
    //se muestra la info de las clases de vacaciones nada mas.
    
    
    const {data,error} = await supabase.rpc('get_classrooms',{current_semester:current_semester ?? false});
        if (error) {
            res.status(500).json({ error: error.message });
            return;
        }
        const classroomsMap = (data as ClassroomResponse).reduce((acc, classroom) => {
            const building = classroom.building;
            if (!acc[building]) {
            acc[building] = [];
            }
            acc[building].push(classroom);
            return acc;
        }, {} as { [key: string]: ClassroomData[] });

        res.status(200).json(classroomsMap);

});
export default router;