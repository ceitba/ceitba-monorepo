export interface Root {
    courseCommissions: CourseCommissions
  }
  
  export interface CourseCommissions {
    courseCommission: CourseCommission[]
  }
  
  export interface CourseCommission {
    subjectCode: string
    subjectName: string
    subjectType: string
    courseStart: string
    courseEnd: string
    commissionName: string
    commissionId: string
    quota: string
    enrolledStudents: string
    courseCommissionTimes: any[]
  }
  
  export interface Comissions{
    subject_code: string
    subject_type: string
    course_start: Date
    course_end: Date
    commission_name: string
    id: string
    quota: string
    enrolled_students: string
  }

  export interface CourseCommissionTime {
    course_id:string
    day: string
    class_room: string
    building: string
    hour_from: string
    hour_to: string
  }