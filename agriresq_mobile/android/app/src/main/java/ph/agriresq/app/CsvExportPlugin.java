package ph.agriresq.app;

import android.app.Activity;
import android.content.Intent;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "CsvExport")
public class CsvExportPlugin extends Plugin {
    @PluginMethod
    public void save(PluginCall call) {
        String filename = call.getString("filename");
        String content = call.getString("content");
        if (filename == null || content == null || content.isEmpty()) {
            call.reject("The CSV file is missing its name or contents.");
            return;
        }

        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("text/csv");
        intent.putExtra(Intent.EXTRA_TITLE, filename);
        startActivityForResult(call, intent, "writeCsv");
    }

    @ActivityCallback
    private void writeCsv(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK) {
            call.resolve();
            return;
        }

        Intent data = result.getData();
        if (data == null || data.getData() == null) {
            call.reject("Android did not return a location for the CSV file.");
            return;
        }

        try (OutputStream output = getContext().getContentResolver().openOutputStream(data.getData(), "wt")) {
            if (output == null) throw new IOException("Could not open the selected document.");
            output.write(call.getString("content").getBytes(StandardCharsets.UTF_8));
        } catch (IOException | SecurityException error) {
            call.reject("Could not save the sensor report.", error);
            return;
        }
        call.resolve();
    }
}
