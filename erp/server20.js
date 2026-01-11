const express = require("express");
const AWS = require("aws-sdk");
const cors = require("cors");

const app = express();
const port = 3000;

AWS.config.update({ region: "ap-south-1" });
const dynamo = new AWS.DynamoDB.DocumentClient();

app.use(cors());
app.use(express.json());

// === LOGIN API ===
app.post("/api/auth/login", async (req, res) => {
  const { userId } = req.body;
  if (!userId)
    return res.status(400).json({ message: "UserID required" });

  const params = {
    TableName: "Student",
    KeyConditionExpression: "StudentID = :sid",
    ExpressionAttributeValues: { ":sid": userId }
  };
  try {
    const data = await dynamo.query(params).promise();
    if (!data.Items || data.Items.length === 0) {
      return res.status(401).json({ message: "User not found" });
    }
    const student = data.Items[0];
    res.json({
      user: { type: "student", id: student.StudentID },
      studentData: student,
      success: true
    });
  } catch (err) {
    res.status(500).json({ message: "Server error", error: err.message });
  }
});

// === FEE STRUCTURE ENDPOINT ===
app.get('/api/feestructure', async (req, res) => {
  const { courseId } = req.query;
  if (!courseId) {
    return res.status(400).json({ error: "courseId required" });
  }

  const params = {
    TableName: "FeesStructure",
    KeyConditionExpression: "CourseID = :cid",
    ExpressionAttributeValues: { ":cid": courseId }
  };
  try {
    const data = await dynamo.query(params).promise();
    res.json((data.Items || []).sort((a, b) => Number(a.Sem) - Number(b.Sem)));
  } catch (err) {
    res.status(500).json({ error: "Error querying FeesStructure", details: err.message });
  }
});

// === FEES PAID ENDPOINT ===
app.get('/api/feepaid', async (req, res) => {
  const { studentId } = req.query;
  if (!studentId)
    return res.status(400).json({ error: "studentId required" });

  const params = {
    TableName: "FeesPaid",
    KeyConditionExpression: "StudentID = :sid",
    ExpressionAttributeValues: { ":sid": studentId }
  };
  try {
    const data = await dynamo.query(params).promise();
    res.json((data.Items || []).sort((a, b) => Number(a.Sem) - Number(b.Sem)));
  } catch (err) {
    res.status(500).json({ error: "Error querying FeesPaid", details: err.message });
  }
});

// === ATTENDANCE ENDPOINT (with debugging) ===
app.get('/api/attendance', async (req, res) => {
  const studentId = req.query.studentId;
  const params = {
    TableName: "Attendance",
    KeyConditionExpression: "StudentID = :sid",
    ExpressionAttributeValues: { ":sid": studentId }
  };
  const result = await dynamo.query(params).promise();
  res.json(result.Items || []);
});

// === SUBJECTS ENDPOINT ===
app.get('/api/subjects', async (req, res) => {
  const { courseId, branch, specialization, semester } = req.query;
  if (!courseId) {
    return res.status(400).json({ error: "courseId required" });
  }

  const params = {
    TableName: "Subjects",
    KeyConditionExpression: "CourseID = :cid",
    ExpressionAttributeValues: { ":cid": courseId }
  };

  try {
    const data = await dynamo.query(params).promise();
    let subjects = data.Items || [];
    if (branch) {
      subjects = subjects.filter(s => (s.Branch || "").toLowerCase() === branch.toLowerCase());
    }
    if (specialization) {
      subjects = subjects.filter(s => (s.Specialization || "").toLowerCase() === specialization.toLowerCase());
    }
    if (semester) {
      subjects = subjects.filter(s => String(s.Semester) === String(semester));
    }
    res.json(subjects);
  } catch (err) {
    res.status(500).json({ error: "Error querying Subjects", details: err.message });
  }
});

// === HOSTEL ASSIGNED ENDPOINT (MERGED) ===
app.get('/api/hostel-assigned/:studentId', async (req, res) => {
  const studentId = req.params.studentId;
  if (!studentId) return res.status(400).json({ error: "studentId required" });

  try {
    // 1. Get student's hostel assignment
    const assignedParams = {
      TableName: "HostelAssigned",
      KeyConditionExpression: "StudentID = :sid",
      ExpressionAttributeValues: { ":sid": studentId }
    };
    const assignedData = await dynamo.query(assignedParams).promise();
    if (!assignedData.Items || assignedData.Items.length === 0)
      return res.status(404).json({ error: "Not found" });
    const assignedInfo = assignedData.Items[0];

    // 2. Fetch hostel meta from Hostel table via HostelID
    let hostelMeta = {};
    if (assignedInfo.HostelID) {
      const hostelParams = {
        TableName: "Hostel",
        Key: { HostelID: assignedInfo.HostelID }
      };
      const hostelResult = await dynamo.get(hostelParams).promise();
      hostelMeta = hostelResult.Item || {};
    }

    // 3. Merge for UI
    res.json({
      HostelName: hostelMeta.HostelName || assignedInfo.HostelID || "-",
      RoomNumber: assignedInfo.RoomNo || "-",
      MonthlyFee: hostelMeta.MonthlyFee || "-",
      CheckInDate: assignedInfo.CheckInDate || "-",
      WardenName: hostelMeta.WardenName || "",
      WardenPhone: hostelMeta.WardenPhone || "",
      Floor: assignedInfo.Floor || hostelMeta.Floor || "",
      RoomType: assignedInfo.RoomType || hostelMeta.RoomType || ""
    });
  } catch (err) {
    res.status(500).json({ error: "DB error", details: err.message });
  }
});

// === HOSTEL FEE ENDPOINT ===
app.get('/api/hostel-fee/:studentId', async (req, res) => {
  const studentId = req.params.studentId;
  if (!studentId) return res.status(400).json({ error: "studentId required" });
  const params = {
    TableName: "HostelFee",
    KeyConditionExpression: "StudentID = :sid",
    ExpressionAttributeValues: { ":sid": studentId }
  };
  try {
    const data = await dynamo.query(params).promise();
    if (!data.Items || data.Items.length === 0)
      return res.status(404).json({ Fees: [] });
    res.json(data.Items[0]);
  } catch (err) {
    res.status(500).json({ error: "DB error", details: err.message });
  }
});

// === PAY HOSTEL FEE ===
app.post('/api/hostel-fee/pay', async (req, res) => {
  const { studentId, item } = req.body;
  if (!studentId || !item)
    return res.status(400).json({ error: "studentId and item required" });
  try {
    // Fetch the record
    const getParams = {
      TableName: "HostelFee",
      Key: { StudentID: studentId }
    };
    const rec = await dynamo.get(getParams).promise();
    if (!rec.Item) return res.status(404).json({ error: "No record found" });

    // Change the target item's status to Paid
    const updatedFees = rec.Item.Fees.map(f => 
      f.Item === item ? { ...f, Status: "Paid" } : f);
    // Write back
    const updateParams = {
      TableName: "HostelFee",
      Key: { StudentID: studentId },
      UpdateExpression: "SET Fees = :fees",
      ExpressionAttributeValues: { ":fees": updatedFees }
    };
    await dynamo.update(updateParams).promise();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "DB error", details: err.message });
  }
});

// === GET HOSTEL COMPLAINTS FOR A STUDENT ===
app.get('/api/hostel-complaint/:studentId', async (req, res) => {
  const studentId = req.params.studentId;
  if (!studentId) return res.status(400).json({ error: "studentId required" });
  const params = {
    TableName: "HostelComplaint",
    KeyConditionExpression: "StudentID = :sid",
    ExpressionAttributeValues: { ":sid": studentId }
  };
  try {
    const data = await dynamo.query(params).promise();
    res.json(data.Items || []);
  } catch (err) {
    res.status(500).json({ error: "DB error", details: err.message });
  }
});

// === REGISTER NEW HOSTEL COMPLAINT ===
app.post('/api/hostel-complaint', async (req, res) => {
  const comp = req.body;
  if (!comp.StudentID || !comp.ComplaintID) {
    return res.status(400).json({ error: "StudentID and ComplaintID required" });
  }
  const params = {
    TableName: "HostelComplaint",
    Item: comp
  };
  try {
    await dynamo.put(params).promise();
    res.status(201).json({ success: true, complaint: comp });
  } catch (err) {
    res.status(500).json({ error: "DB error", details: err.message });
  }
});



// === GET FACULTY BY ID ===
app.get('/faculty/:facultyId', async (req, res) => {
  const facultyId = req.params.facultyId;
  if (!facultyId) return res.status(400).json({ error: "facultyId required" });

  const params = {
    TableName: "Faculty",
    KeyConditionExpression: "FacultyID = :fid",
    ExpressionAttributeValues: { ":fid": facultyId }
  };

  try {
    const data = await dynamo.query(params).promise();
    if (!data.Items || data.Items.length === 0)
      return res.status(404).json({ error: "Faculty not found" });
    res.json(data.Items[0]);
  } catch (err) {
    res.status(500).json({ error: "Error querying Faculty", details: err.message });
  }
});



// Query students by courseId, branch, semester, section (case-insensitive for section)
app.get('/api/students', async (req, res) => {
  const { courseId, branch, semester, section } = req.query;
  const params = { TableName: "Student" };
  try {
    // Always scan (get ALL students)
    const result = await dynamo.scan(params).promise();
    let students = result.Items || [];

    // Only filter by courseId if NOT "all"
    if (courseId && courseId !== "all")
      students = students.filter(s => s.CourseID === courseId);

    if (branch && branch !== "all")
      students = students.filter(s => s.Branch === branch);

    if (semester && semester !== "all")
      students = students.filter(s => String(s.CurrentSem) === String(semester));

    if (section && section.trim())
      students = students.filter(s => (s.Section || "").toLowerCase() === section.trim().toLowerCase());

    res.json(students);
  } catch (err) {
    res.status(500).json({ error: "DB error", details: err.message });
  }
});




// All CourseDetails
app.get('/api/coursedetails', async (req, res) => {
  const params = { TableName: "CourseDetails" };
  try {
    const data = await dynamo.scan(params).promise();
    res.json(data.Items || []);
  } catch (err) {
    res.status(500).json({ error: "Error querying CourseDetails", details: err.message });
  }
});



// Calculate overall attendance percentage for a StudentID
app.get('/api/attendance-overall/:studentId', async (req, res) => {
  const studentId = req.params.studentId;
  if (!studentId) return res.status(400).json({ error: "studentId required" });

  const params = {
    TableName: "Attendance",
    KeyConditionExpression: "StudentID = :sid",
    ExpressionAttributeValues: { ":sid": studentId }
  };
  try {
    const data = await dynamo.query(params).promise();
    const attRecords = data.Items || [];
    // Calculate attendance based on Status field
    const total = attRecords.length;
    const present = attRecords.filter(r =>
      (r.Status || "").toLowerCase() === "present"
    ).length;
    const overall = (total > 0) ? Math.round((present / total) * 100) : "--";
    res.json({ overall });
  } catch (err) {
    res.status(500).json({ error: "Error querying Attendance", details: err.message });
  }
});




// === UPDATE FACULTY PROFILE ===
app.put('/api/faculty/:facultyId', async (req, res) => {
  const facultyId = req.params.facultyId;
  const updatedData = req.body;

  if (!facultyId) {
    return res.status(400).json({ error: "facultyId required" });
  }

  // Get current faculty record to retrieve the Department (sort key)
  try {
    // First, get the current record to know the Department
    const getParams = {
      TableName: "Faculty",
      KeyConditionExpression: "FacultyID = :fid",
      ExpressionAttributeValues: { ":fid": facultyId }
    };
    const currentData = await dynamo.query(getParams).promise();
    
    if (!currentData.Items || currentData.Items.length === 0) {
      return res.status(404).json({ error: "Faculty not found" });
    }

    const currentFaculty = currentData.Items[0];
    const department = currentFaculty.Department; // Sort key

    // Build update expression dynamically
    let updateExpression = "SET";
    let expressionAttributeNames = {};
    let expressionAttributeValues = {};
    let counter = 0;

    const allowedFields = [
      "Name", "OfficialEmail", "PersonalEmail", "PhoneNo", 
      "Designation", "Qualification", "Specialization", 
      "JoiningDate", "DOB", "Gender", "Address", "PhotoURL"
    ];

    allowedFields.forEach(field => {
      if (updatedData[field] !== undefined) {
        counter++;
        const placeholder = `#field${counter}`;
        const valuePlaceholder = `:val${counter}`;
        updateExpression += ` ${placeholder} = ${valuePlaceholder},`;
        expressionAttributeNames[placeholder] = field;
        expressionAttributeValues[valuePlaceholder] = updatedData[field];
      }
    });

    // Remove trailing comma
    updateExpression = updateExpression.slice(0, -1);

    if (counter === 0) {
      return res.status(400).json({ error: "No valid fields to update" });
    }

    // Update the record
    const updateParams = {
      TableName: "Faculty",
      Key: {
        FacultyID: facultyId,
        Department: department
      },
      UpdateExpression: updateExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ReturnValues: "ALL_NEW"
    };

    const result = await dynamo.update(updateParams).promise();
    res.json({ 
      success: true, 
      message: "Profile updated successfully",
      data: result.Attributes 
    });

  } catch (err) {
    console.error("Error updating faculty profile:", err);
    res.status(500).json({ 
      error: "Error updating profile", 
      details: err.message 
    });
  }
});




// GET admin by ID - CORRECT VERSION for your table structure
// GET admin by ID - CORRECT VERSION (No sort key)
app.get("/api/admin/:adminId", async (req, res) => {
  try {
    const { adminId } = req.params;

    const params = {
      TableName: "Admin",
      Key: {
        AdminID: adminId
      }
    };

    const result = await dynamo.get(params).promise();

    if (!result.Item) {
      return res.status(404).json({ error: "Admin not found" });
    }

    res.json(result.Item);
  } catch (error) {
    console.error("Error fetching admin:", error);
    res.status(500).json({ error: "Failed to fetch admin data" });
  }
});




const multer = require('multer');
const upload = multer(); // In-memory file upload

const s3 = new AWS.S3({ region: 'ap-south-1' });
const BUCKET = 'erp-s101';

app.post('/upload-photo/:studentId', upload.single('photo'), async (req, res) => {
  const studentId = req.params.studentId;
  const file = req.file;
  console.log(`[UPLOAD-PHOTO] Received upload for StudentID: ${studentId}`);
  if (!file) {
    console.error("[UPLOAD-PHOTO] No file uploaded.");
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  // Save directly in the bucket root
  const key = `${studentId}.jpg`;

  try {
    const result = await s3.putObject({
      Bucket: BUCKET,
      Key: key,
      Body: file.buffer,
      ContentType: 'image/jpeg',
      ACL: 'public-read'
    }).promise();
    console.log(`[UPLOAD-PHOTO] Uploaded: ${key} Result:`, result);

    // S3 URL (no folder)
    const url = `https://${BUCKET}.s3.ap-south-1.amazonaws.com/${key}`;
    res.json({ url });
  } catch (err) {
    console.error("[UPLOAD-PHOTO] S3 error:", err);
    res.status(500).json({ error: 'Upload failed.' });
  }
});


app.post('/students', async (req, res) => {
  try {
    const data = req.body;
    console.log("[ADD-STUDENT] Payload:", JSON.stringify(data, null, 2));
    await dynamo.put({ TableName: 'Student', Item: data }).promise();
    console.log("[ADD-STUDENT] Successfully saved Student record!");

    // Hostel logic
    const hostelId = 'H001';
    const lastRoomNo = await getLastRoomNo(hostelId);
    console.log(`[ADD-STUDENT] Last assigned room for ${hostelId}:`, lastRoomNo);
    const newRoomNo = (lastRoomNo + 1).toString();

    const hostelAssignment = {
      StudentID: data.StudentID,
      HostelID: hostelId,
      RoomNo: newRoomNo,
      StudentPhoneNo: data.StudentPhoneNo
    };

    await dynamo.put({ TableName: 'HostelAssigned', Item: hostelAssignment }).promise();
    console.log(`[ADD-STUDENT] Hostel assigned:`, hostelAssignment);

    res.json({ ...data, hostelAssignment });
  } catch (err) {
    console.error("[ADD-STUDENT] ERROR:", err);
    res.status(500).json({ error: 'Failed to add student or assign hostel.', details: err });
  }
});

app.get('/students', async (req, res) => {
  try {
    console.log("[GET-STUDENTS] Scanning table...");
    const resDb = await dynamo.scan({ TableName: 'Student' }).promise();
    console.log("[GET-STUDENTS] Items retrieved:", resDb.Items.length);
    res.json(resDb.Items);
  } catch (err) {
    console.error("[GET-STUDENTS] ERROR:", err);
    res.status(500).json({ error: 'Failed to fetch students.', details: err });
  }
});

app.put('/students/:id', async (req, res) => {
  const id = req.params.id;
  try {
    console.log("[UPDATE-STUDENT] Updating id:", id, "Data:", req.body);
    await dynamo.put({ TableName: 'Student', Item: { ...req.body, StudentID: id } }).promise();
    console.log("[UPDATE-STUDENT] Successful update for", id);
    res.json({ ...req.body, StudentID: id });
  } catch (err) {
    console.error("[UPDATE-STUDENT] ERROR:", err);
    res.status(500).json({ error: 'Failed to update student.', details: err });
  }
});

app.delete('/students/:id', async (req, res) => {
  const id = req.params.id;
  try {
    console.log("[DELETE-STUDENT] Deleting id:", id);
    await dynamo.delete({ TableName: 'Student', Key: { StudentID: id } }).promise();
    console.log("[DELETE-STUDENT] Deleted StudentID:", id);
    res.json({ success: true });
  } catch (err) {
    console.error("[DELETE-STUDENT] ERROR:", err);
    res.status(500).json({ error: 'Failed to delete student.', details: err });
  }
});

app.get("/coursedetails/:courseId", async (req, res) => {
  try {
    const { courseId } = req.params;
    console.log("[GET-COURSEDETAILS] Fetch by CourseID:", courseId);
    const params = {
      TableName: "CourseDetails",
      Key: { CourseID: courseId }
    };
    const result = await dynamo.get(params).promise();
    if (!result.Item) {
      console.warn("[GET-COURSEDETAILS] Not found:", courseId);
      return res.status(404).json({ error: "Course not found" });
    }
    console.log("[GET-COURSEDETAILS] Get result:", result.Item);
    res.json(result.Item);
  } catch (err) {
    console.error("[GET-COURSEDETAILS] ERROR:", err);
    res.status(500).json({ error: "Failed to fetch course details", details: err });
  }
});

async function getLastRoomNo(hostelId) {
  const res = await dynamo.scan({
    TableName: 'HostelAssigned',
    FilterExpression: 'HostelID = :h',
    ExpressionAttributeValues: { ':h': hostelId }
  }).promise();

  // Find the max RoomNo in results
  if (res.Items.length === 0) return 0;
  return Math.max(...res.Items.map(i => parseInt(i.RoomNo, 10) || 0));
}




// === GET CIRCULARS BY COURSE ID ===
app.get("/api/circulars/:courseId", async (req, res) => {
  const { courseId } = req.params;

  if (!courseId) {
    return res.status(400).json({ error: "courseId required" });
  }

  const params = {
    TableName: "Circulars",
    KeyConditionExpression: "CourseID = :cid",
    ExpressionAttributeValues: {
      ":cid": courseId
    },
    ScanIndexForward: false // newest first
  };

  try {
    const data = await dynamo.query(params).promise();
    res.json(data.Items || []);
  } catch (err) {
    console.error("[GET-CIRCULARS] DynamoDB error:", err);
    res.status(500).json({ error: "Failed to fetch circulars", details: err.message });
  }
});




app.get("/api/exams/upcoming", async (req, res) => {
  try {
    const { courseId, semester } = req.query;
    if (!courseId || !semester) {
      return res.status(400).json({ error: "courseId and semester required" });
    }

    const params = {
      TableName: "ExamSchedule",
      KeyConditionExpression:
        "CourseID = :cid AND begins_with(#sk, :sem)",
      ExpressionAttributeNames: {
        "#sk": "Semester#ExamDateTime"
      },
      ExpressionAttributeValues: {
        ":cid": courseId,
        ":sem": `${semester}#`
      }
    };

    const data = await dynamo.query(params).promise();
    res.json(data.Items || []);
  } catch (err) {
    console.error("[UPCOMING-EXAMS]", err);
    res.status(500).json({ error: "Failed to fetch exams" });
  }
});




app.get("/api/exams/admit-card/:studentId", async (req, res) => {
  try {
    const studentId = req.params.studentId;

    const params = {
      TableName: "AdmitCards",
      KeyConditionExpression: "StudentID = :sid",
      ExpressionAttributeValues: {
        ":sid": studentId
      }
    };

    const data = await dynamo.query(params).promise();
    res.json(data.Items || []);
  } catch (err) {
    console.error("[ADMIT-CARDS]", err);
    res.status(500).json({ error: "Failed to fetch admit cards" });
  }
});



app.post("/api/exams/admit-card/downloaded", async (req, res) => {
  try {
    const { studentId, semester } = req.body;

    const params = {
      TableName: "AdmitCards",
      Key: {
        StudentID: studentId,
        Semester: Number(semester)
      },
      UpdateExpression: "SET Downloaded = :d",
      ExpressionAttributeValues: {
        ":d": true
      }
    };

    await dynamo.update(params).promise();
    res.json({ success: true });
  } catch (err) {
    console.error("[ADMIT-DOWNLOADED]", err);
    res.status(500).json({ error: "Update failed" });
  }
});


app.get("/api/exams/results/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    const { semester } = req.query;

    console.log("========== [RESULTS API HIT] ==========");
    console.log("StudentID:", studentId);
    console.log("Semester (raw):", semester);

    if (!semester) {
      console.error("[RESULTS] Semester missing in query");
      return res.status(400).json({ error: "semester required" });
    }

    const semesterPrefix = `${semester}#`;
    console.log("Query Prefix:", semesterPrefix);

    // ---- QUERY RESULTS TABLE ----
    const resultParams = {
      TableName: "Results",
      KeyConditionExpression:
        "StudentID = :sid AND begins_with(#sk, :sem)",
      ExpressionAttributeNames: {
        "#sk": "Semester#SubjectCode"
      },
      ExpressionAttributeValues: {
        ":sid": studentId,
        ":sem": semesterPrefix
      }
    };

    console.log(
      "[RESULTS] Query Params:",
      JSON.stringify(resultParams, null, 2)
    );

    const subjectsRes = await dynamo.query(resultParams).promise();

    console.log(
      "[RESULTS] Subjects Found:",
      subjectsRes.Items?.length || 0
    );

    // ---- QUERY SUMMARY TABLE ----
    const summaryParams = {
      TableName: "SemesterSummary",
      Key: {
        StudentID: studentId,
        Semester: Number(semester)
      }
    };

    console.log(
      "[RESULTS] Summary Get Params:",
      JSON.stringify(summaryParams, null, 2)
    );

    const summaryRes = await dynamo.get(summaryParams).promise();

    console.log(
      "[RESULTS] Summary Found:",
      summaryRes.Item ? "YES" : "NO"
    );

    // ---- RESPONSE ----
    res.json({
      subjects: subjectsRes.Items || [],
      summary: summaryRes.Item || null
    });

    console.log("========== [RESULTS API DONE] ==========");
  } catch (err) {
    console.error("❌ [RESULTS API ERROR]", err);
    res.status(500).json({
      error: "Failed to fetch results",
      details: err.message
    });
  }
});





app.get("/api/placement/stats/:courseId", async (req, res) => {
  try {
    console.log("[PLACEMENT-STATS] CourseID:", req.params.courseId);

    const data = await dynamo.get({
      TableName: "PlacementStats",
      Key: { CourseID: req.params.courseId }
    }).promise();

    console.log("[PLACEMENT-STATS] Result:", data.Item);
    res.json(data.Item || {});
  } catch (err) {
    console.error("[PLACEMENT-STATS ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});


app.get("/api/placement/drives", async (req, res) => {
  try {
    const { courseId } = req.query;
    console.log("[PLACEMENT-DRIVES] courseId:", courseId);

    const params = {
      TableName: "PlacementDrives",
      KeyConditionExpression: "CourseID = :cid",
      ExpressionAttributeValues: { ":cid": courseId }
    };

    console.log("[PLACEMENT-DRIVES] Params:", params);

    const data = await dynamo.query(params).promise();
    console.log("[PLACEMENT-DRIVES] Found:", data.Items.length);

    res.json(data.Items || []);
  } catch (err) {
    console.error("[PLACEMENT-DRIVES ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});





app.get("/api/placement/profile/:studentId", async (req, res) => {
  try {
    const studentId = req.params.studentId;
    console.log("[PLACEMENT-PROFILE] StudentID:", studentId);

    const params = {
      TableName: "StudentPlacementProfile",
      Key: { StudentID: studentId }
    };

    const data = await dynamo.get(params).promise();
    console.log("[PLACEMENT-PROFILE] Result:", data.Item);

    if (!data.Item) {
      return res.status(404).json({ error: "Placement profile not found" });
    }

    res.json(data.Item);
  } catch (err) {
    console.error("[PLACEMENT-PROFILE ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});



app.post("/api/placement/apply", async (req, res) => {
  try {
    const { studentId, companyId, courseId } = req.body;

    console.log("[PLACEMENT-APPLY] Request:", req.body);

    if (!studentId || !companyId || !courseId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const item = {
      StudentID: studentId,
      CompanyID: companyId,
      CourseID: courseId,
      AppliedOn: new Date().toISOString().split("T")[0],
      Status: "Applied"
    };

    await dynamo.put({
      TableName: "PlacementApplications",
      Item: item,
      ConditionExpression:
        "attribute_not_exists(StudentID) AND attribute_not_exists(CompanyID)"
    }).promise();

    console.log("[PLACEMENT-APPLY] Saved:", item);

    res.json({ success: true });
  } catch (err) {
    console.error("[PLACEMENT-APPLY ERROR]", err);

    if (err.code === "ConditionalCheckFailedException") {
      return res
        .status(409)
        .json({ error: "Already applied to this company" });
    }

    res.status(500).json({ error: "Failed to apply", details: err.message });
  }
});




app.get("/api/placement/applications/:studentId", async (req, res) => {
  try {
    const { studentId } = req.params;
    console.log("[PLACEMENT-APPLICATIONS] StudentID:", studentId);

    const params = {
      TableName: "PlacementApplications",
      KeyConditionExpression: "StudentID = :sid",
      ExpressionAttributeValues: {
        ":sid": studentId
      }
    };

    const data = await dynamo.query(params).promise();

    console.log(
      "[PLACEMENT-APPLICATIONS] Found:",
      data.Items?.length || 0
    );

    res.json(data.Items || []);
  } catch (err) {
    console.error("[PLACEMENT-APPLICATIONS ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});



// === GET GRIEVANCES FOR STUDENT ===
app.get("/api/grievances/:studentId", async (req, res) => {
  const { studentId } = req.params;

  console.log("[GET-GRIEVANCES] StudentID:", studentId);

  const params = {
    TableName: "Grievances",
    KeyConditionExpression: "StudentID = :sid",
    ExpressionAttributeValues: {
      ":sid": studentId
    }
  };

  try {
    const data = await dynamo.query(params).promise();

    console.log("[GET-GRIEVANCES] Items:", data.Items?.length || 0);

    // Sort newest first
    const sorted = (data.Items || []).sort(
      (a, b) => new Date(b.SubmittedAt) - new Date(a.SubmittedAt)
    );

    res.json(sorted);
  } catch (err) {
    console.error("[GET-GRIEVANCES ERROR]", err);
    res.status(500).json({
      error: "Failed to fetch grievances",
      details: err.message
    });
  }
});


// === CREATE NEW GRIEVANCE ===
app.post("/api/grievances", async (req, res) => {
  const { StudentID, Title, Category, Priority, Description } = req.body;

  console.log("[CREATE-GRIEVANCE] Payload:", req.body);

  if (!StudentID || !Title || !Category || !Priority || !Description) {
    return res.status(400).json({
      error: "Missing required fields"
    });
  }

  const now = new Date().toISOString().split("T")[0];

  const grievanceItem = {
    StudentID,
    GrievanceID: "G" + Date.now(), // unique + sortable
    Title,
    Category,
    Priority,
    Status: "Under Review",
    Description,
    SubmittedAt: now,
    LastUpdatedAt: now
  };

  try {
    await dynamo.put({
      TableName: "Grievances",
      Item: grievanceItem
    }).promise();

    console.log("[CREATE-GRIEVANCE] Saved:", grievanceItem.GrievanceID);

    res.status(201).json({
      success: true,
      grievance: grievanceItem
    });
  } catch (err) {
    console.error("[CREATE-GRIEVANCE ERROR]", err);
    res.status(500).json({
      error: "Failed to create grievance",
      details: err.message
    });
  }
});


app.get("/api/feedback/faculty/:courseId/:semester", async (req, res) => {
  const { courseId, semester } = req.params;
  console.log("[FEEDBACK] Faculty list for", courseId, semester);

  try {
    // 1. Subjects
    const subjects = await dynamo.query({
      TableName: "Subjects",
      KeyConditionExpression: "CourseID = :cid",
      ExpressionAttributeValues: { ":cid": courseId }
    }).promise();

    const semSubjects = subjects.Items.filter(
      s => Number(s.Semester) === Number(semester)
    );

    // 2. Faculty assignments
    const courseSemester = `${courseId}#${semester}`;
    const assignments = await dynamo.query({
      TableName: "FacultyAssignments",
      KeyConditionExpression: "CourseSemester = :cs",
      ExpressionAttributeValues: { ":cs": courseSemester }
    }).promise();

    // 3. Merge faculty + subject
    const result = [];
    for (const s of semSubjects) {
      const a = assignments.Items.find(x => x.SubjectCode === s.SubjectCode);
      if (!a) continue;

      const faculty = await dynamo.get({
        TableName: "Faculty",
        Key: {
          FacultyID: a.FacultyID,
          Department: s.Branch
        }
      }).promise();

      if (faculty.Item) {
        result.push({
          FacultyID: faculty.Item.FacultyID,
          FacultyName: faculty.Item.Name,
          SubjectCode: s.SubjectCode,
          SubjectName: s.SubjectName
        });
      }
    }

    res.json(result);
  } catch (err) {
    console.error("[FEEDBACK FACULTY ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});


app.get("/api/feedback/:studentId", async (req, res) => {
  console.log("[FEEDBACK] Fetching for", req.params.studentId);

  try {
    const data = await dynamo.query({
      TableName: "Feedback",
      KeyConditionExpression: "StudentID = :sid",
      ExpressionAttributeValues: { ":sid": req.params.studentId }
    }).promise();

    res.json(data.Items || []);
  } catch (err) {
    console.error("[FEEDBACK FETCH ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});


app.post("/api/feedback", async (req, res) => {
  console.log("[FEEDBACK SUBMIT]", req.body);

  try {
    await dynamo.put({
      TableName: "Feedback",
      Item: {
        ...req.body,
        SubmittedAt: new Date().toISOString().split("T")[0]
      }
    }).promise();

    res.json({ success: true });
  } catch (err) {
    console.error("[FEEDBACK SUBMIT ERROR]", err);
    res.status(500).json({ error: err.message });
  }
});



app.get("/api/resources", async (req, res) => {
  const {
    courseId,
    branch,
    semester,
    section,
    specialization
  } = req.query;

  console.log("[GET-RESOURCES]", req.query);

  try {
    const params = {
      TableName: "Resources",
      FilterExpression: `
        CourseID = :cid
        AND Branch = :branch
        AND Semester = :sem
        AND IsActive = :active
      `,
      ExpressionAttributeValues: {
        ":cid": courseId,
        ":branch": branch,
        ":sem": Number(semester),
        ":active": true
      },
      ExpressionAttributeNames: {}
    };

    // SECTION (reserved keyword)
    if (section) {
      params.FilterExpression += " AND #sec = :section";
      params.ExpressionAttributeValues[":section"] = section;
      params.ExpressionAttributeNames["#sec"] = "Section";
    }

    // SPECIALIZATION (optional)
    if (specialization) {
      params.FilterExpression += " AND Specialization = :spec";
      params.ExpressionAttributeValues[":spec"] = specialization;
    }

    const result = await dynamo.scan(params).promise();

    console.log("[GET-RESOURCES] Returned:", result.Items.length);

    res.json(result.Items);
  } catch (err) {
    console.error("[GET-RESOURCES ERROR]", err);
    res.status(500).json({ error: "Failed to fetch resources" });
  }
});


app.get("/api/courses", async (req, res) => {
  try {
    const result = await dynamo.scan({
      TableName: "CourseDetails",
    }).promise();

    res.json(result.Items); // ✅ IMPORTANT
  } catch (err) {
    console.error("[GET COURSES ERROR]", err);
    res.status(500).json({ error: "Failed to fetch courses" });
  }
});


app.get("/api/course-sections", async (req, res) => {
  const { courseId, semester } = req.query;

  if (!courseId || !semester) {
    return res.status(400).json({ error: "courseId and semester required" });
  }

  try {
    const data = await dynamo.scan({
      TableName: "CourseSections",
      FilterExpression: "CourseID = :cid AND Semester = :sem",
      ExpressionAttributeValues: {
        ":cid": courseId,
        ":sem": Number(semester),
      },
    }).promise();

    res.json(data.Items?.[0]?.Sections || []);
  } catch (err) {
    console.error("[GET SECTIONS ERROR]", err);
    res.status(500).json({ error: "Failed to fetch sections" });
  }
});

app.get("/api/students", async (req, res) => {
  const { courseId, semester, section } = req.query;

  if (!courseId || !semester || !section) {
    return res.status(400).json({ message: "Missing parameters" });
  }

  try {
    const params = {
      TableName: "Students",
      FilterExpression:
        "#cid = :c AND #sem = :s AND #sec = :sec",
      ExpressionAttributeNames: {
        "#cid": "CourseID",
        "#sem": "CurrentSem",
        "#sec": "Section",
      },
      ExpressionAttributeValues: {
        ":c": courseId,
        ":s": Number(semester),
        ":sec": section,
      },
    };

    const data = await dynamo.scan(params).promise();

    // ✅ NUMERIC sort (ClassRollNo is string in DB)
    const sorted = (data.Items || []).sort(
      (a, b) =>
        Number(a.ClassRollNo || 0) - Number(b.ClassRollNo || 0)
    );

    res.json(sorted);
  } catch (err) {
    console.error("[GET STUDENTS ERROR]", err);
    res.status(500).json({ message: "Failed to fetch students" });
  }
});


app.post("/api/attendance", async (req, res) => {
  const { records } = req.body;

  if (!Array.isArray(records) || !records.length) {
    return res.status(400).json({ message: "Invalid records" });
  }

  try {
    const putRequests = records.map((r) => ({
      PutRequest: { Item: r },
    }));

    const params = {
      RequestItems: {
        Attendance: putRequests,
      },
    };

    await dynamo.batchWrite(params).promise();
    res.json({ success: true });
  } catch (err) {
    console.error("ATTENDANCE SAVE ERROR", err);
    res.status(500).json({ error: "Failed to save attendance" });
  }
});


app.get("/api/faculty-assignments", async (req, res) => {
  const { courseId, semester, section, facultyId } = req.query;

  if (!courseId || !semester || !section || !facultyId) {
    return res.status(400).json({ error: "Missing query params" });
  }

  const params = {
    TableName: "FacultyAssignments",
    FilterExpression:
      "CourseSemester = :cs AND #sec = :sec AND FacultyID = :fid",
    ExpressionAttributeNames: {
      "#sec": "Section", // 👈 alias reserved keyword
    },
    ExpressionAttributeValues: {
      ":cs": `${courseId}#${semester}`,
      ":sec": section,
      ":fid": facultyId,
    },
  };

  try {
    const data = await dynamo.scan(params).promise();
    res.json(data.Items?.[0] || {});
  } catch (err) {
    console.error("FACULTY ASSIGNMENT ERROR:", err);
    res.status(500).json({ error: "Failed to fetch faculty assignment" });
  }
});



app.get("/api/subjects/by-code", async (req, res) => {
  const { courseId, subjectCode } = req.query;

  const params = {
    TableName: "Subjects",
    FilterExpression: "CourseID = :c AND SubjectCode = :s",
    ExpressionAttributeValues: {
      ":c": courseId,
      ":s": subjectCode,
    },
  };

  const data = await dynamo.scan(params).promise();
  res.json(data.Items?.[0] || {});
});

// GET /api/faculty/feedback/:facultyId
app.get("/api/faculty/feedback/:facultyId", async (req, res) => {
  const { facultyId } = req.params;

  try {
    const data = await dynamo.scan({
      TableName: "Feedback",
      FilterExpression: "FacultyID = :fid",
      ExpressionAttributeValues: {
        ":fid": facultyId,
      },
    }).promise();

    res.json(data.Items || []);
  } catch (err) {
    console.error("FACULTY FEEDBACK ERROR", err);
    res.status(500).json({ error: "Failed to load feedback" });
  }
});

















app.listen(port, "0.0.0.0", () => {
  console.log(`Backend listening on http://0.0.0.0:${port}`);
});
