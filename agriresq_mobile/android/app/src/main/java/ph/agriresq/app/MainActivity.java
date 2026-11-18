package ph.agriresq.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CsvExportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
